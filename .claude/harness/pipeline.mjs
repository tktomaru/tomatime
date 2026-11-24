// パイプライン CLI: node .claude/harness/pipeline.mjs <start <機能名>|status|advance|back <request|requirements|implementation>>
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import {
  PROJECT_DIR, PHASES, PHASE_INFO, REVIEWS, DOC_KINDS, docDir, checkDocShape, loadState, saveState, isActive, readDoc, docHash, logDecision, clip,
} from './lib.mjs';

const CHECKS_FILE = new URL('./pipeline-checks.json', import.meta.url);
const [cmd, arg] = process.argv.slice(2);
const now = () => new Date().toISOString();
const ok = (msg) => { console.log('OK: ' + msg); process.exit(0); };
// 完了判定で進めなかったことも、AI が次に何をするかの根拠になるので残す
const ng = (msg) => { logDecision('pipeline_rejected', { command: [cmd, arg].filter(Boolean).join(' '), reason: clip(msg) }); console.log('NG: ' + msg); process.exit(1); };

const uniq = (arr) => [...new Set(arr)];
const ids = (text, re) => uniq(text.match(re) ?? []);

function describe(s) {
  const info = PHASE_INFO[s.phase];
  const docs = Object.entries(DOC_KINDS).map(([k, v]) => `  ${v.label}: ${docDir(k, s.feature)}/`).join('\n');
  return `機能: ${s.feature} / フェーズ: ${s.phase}（${info.label}）\n次の作業: ${info.next}\n文書のフォルダ（エージェントにはこのパスを渡す）:\n${docs}`;
}

function move(s, to, note) {
  s.history.push({ at: now(), from: s.phase, to, note });
  const from = s.phase;
  s.phase = to;
  saveState(s);
  logDecision('phase_change', { command: cmd, from, to, note });
}

function listFiles(dir) {
  const abs = path.join(PROJECT_DIR, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules') continue;
    const p = path.join(abs, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(path.join(dir, name)));
    else out.push(p);
  }
  return out;
}

function runCheck(command) {
  try {
    execSync(command, { cwd: PROJECT_DIR, stdio: 'pipe', encoding: 'utf8' });
    return null;
  } catch (e) {
    const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim().split('\n').slice(-30).join('\n');
    return `\`${command}\` が失敗しました。\n${out}`;
  }
}

function patternSource(patterns, name) {
  const source = patterns?.[name];
  if (typeof source !== 'string' || !source) throw new Error(`正規表現「${name}」の定義がありません`);
  return source;
}

function checkFunctionalRequirementAcceptance(_check, { feature, patterns }) {
  const rel = docDir('requirements', feature);
  const text = readDoc(rel) ?? '';
  const frs = ids(text, new RegExp(patternSource(patterns, 'functionalRequirementId'), 'g'));
  if (frs.length === 0) return `${rel} に機能要件（FR-n）がありません`;
  const suffix = patternSource(patterns, 'acceptanceConditionSuffix');
  const noAc = frs.filter((fr) => !new RegExp(`${fr}${suffix}`).test(text));
  if (noAc.length) return `受け入れ条件がない機能要件があります: ${noAc.join(', ')}`;
  return null;
}

function checkRequestCoverage(_check, { feature, patterns }) {
  const text = readDoc(docDir('requirements', feature)) ?? '';
  const reqs = ids(readDoc(docDir('request', feature)) ?? '', new RegExp(patternSource(patterns, 'requestId'), 'g'));
  const idEnd = patternSource(patterns, 'idEnd');
  const missing = reqs.filter((r) => !new RegExp(`${r}${idEnd}`).test(text));
  if (missing.length) return `要件定義書で扱われていない要求があります（「要求との対応」に書く）: ${missing.join(', ')}`;
  return null;
}

function checkApproval(s, kind) {
  const rel = docDir(kind, s.feature);
  const hash = docHash(rel);
  if (!s.approvals?.[kind]) return `${rel}/ はまだ承認されていません。ユーザーが「承認」とだけ返信すると記録されます`;
  if (s.approvals[kind] !== hash) return `${rel}/ は承認後に変更されています（ファイルの追加・削除・改名を含む）。変更内容をユーザーに示し、もう一度承認を受けてください`;
  return null;
}

function checkNpmScripts({ scripts: requiredScripts }) {
  if (!Array.isArray(requiredScripts) || requiredScripts.length === 0) {
    throw new Error('検査する npm スクリプト名を scripts に指定してください');
  }
  const pkgPath = path.join(PROJECT_DIR, 'package.json');
  if (!existsSync(pkgPath)) return 'package.json がありません';
  const scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {};
  const lack = requiredScripts.filter((k) => !scripts[k]);
  if (lack.length) return `package.json に npm スクリプトがありません: ${lack.join(', ')}`;
  return null;
}

function checkAcceptanceTests({ directory }, { feature, patterns }) {
  const testFile = new RegExp(patternSource(patterns, 'testFile'));
  const tests = listFiles(directory).filter((p) => testFile.test(p));
  if (tests.length === 0) return `${directory}/ にテストファイル（*.test.ts）がありません`;
  const testText = tests.map((p) => readFileSync(p, 'utf8')).join('\n');
  const requirements = readDoc(docDir('requirements', feature)) ?? '';
  const acs = ids(requirements, new RegExp(patternSource(patterns, 'acceptanceConditionId'), 'g'));
  const idEnd = patternSource(patterns, 'idEnd');
  const untested = acs.filter((ac) => !new RegExp(`${ac}${idEnd}`).test(testText));
  if (untested.length) return `テストに対応がない受け入れ条件があります（テスト名に ID を含める）: ${untested.join(', ')}`;
  return null;
}

const phaseCheckHandlers = {
  'document-shape': ({ document, errorPrefix = '' }, { feature }) => {
    const error = checkDocShape(docDir(document, feature));
    return error ? `${errorPrefix}${error}` : null;
  },
  'document-pattern': ({ document, pattern, flags, error }, { feature, patterns }) => {
    const rel = docDir(document, feature);
    const rule = new RegExp(patternSource(patterns, pattern), flags);
    return rule.test(readDoc(rel) ?? '') ? null : `${rel}/ ${error}`;
  },
  approval: (_check, { phase, state }) => checkApproval(state, REVIEWS[phase].kind),
  'functional-requirement-acceptance': checkFunctionalRequirementAcceptance,
  'request-coverage': checkRequestCoverage,
  'npm-scripts': checkNpmScripts,
  'acceptance-tests': checkAcceptanceTests,
  'npm-command': ({ command }) => {
    if (!/^npm (?:test|run [A-Za-z0-9:_-]+)$/.test(command)) {
      throw new Error('npm-command には npm test または npm run <スクリプト名> を指定してください');
    }
    return runCheck(command);
  },
};

function checkPhase(state) {
  const { phase, feature } = state;
  const { patterns, phases } = JSON.parse(readFileSync(CHECKS_FILE, 'utf8'));
  const checks = phases?.[phase];
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error(`フェーズ「${phase}」の検査定義がありません`);
  }

  const context = { phase, feature, state, patterns };
  for (const check of checks) {
    if (!Object.hasOwn(phaseCheckHandlers, check?.check)) {
      throw new Error(`フェーズ「${phase}」に未対応の検査があります: ${check?.check}`);
    }
    const error = phaseCheckHandlers[check.check](check, context);
    if (error) return error;
  }
  return null;
}

const state = loadState();

switch (cmd) {
  case 'start': {
    if (!arg || !/^[a-z0-9][a-z0-9-]*$/.test(arg)) ng('機能名を英小文字・数字・ハイフンで指定してください（例: time-server）');
    if (isActive(state)) ng(`進行中のパイプラインがあります。\n${describe(state)}\n続けるか、ユーザーに「中止」とだけ返信してもらってください`);
    const s = { feature: arg, phase: 'request', approvals: {}, history: [{ at: now(), from: null, to: 'request', note: 'start' }] };
    saveState(s);
    logDecision('phase_change', { command: 'start', from: null, to: 'request', note: 'start' });
    ok(describe(s));
  }
  case 'status': {
    if (!state) ok('パイプラインは開始されていません');
    ok(describe(state));
  }
  case 'advance': {
    if (!isActive(state)) ng('進行中のパイプラインがありません');
    const f = state.feature;
    let err;
    try {
      err = checkPhase(state);
    } catch (error) {
      ng(`フェーズ「${state.phase}」の検査を実行できません（pipeline-checks.json）: ${error.message}`);
    }
    if (err) ng(err);
    const to = PHASES[PHASES.indexOf(state.phase) + 1];
    move(state, to, 'advance');
    let msg = describe(state);
    if (REVIEWS[to]) {
      msg += `\nここで人のレビューに入る。${docDir(REVIEWS[to].kind, f)}/ のパスと要約を示し、「内容でよければ『承認』とだけ返信してください」と伝えてターンを終えること。承認を自分で記録したり、AskUserQuestion で取ったりしない。`;
    }
    ok(msg);
  }
  case 'back': {
    const targets = { request: 'request', requirements: 'requirements', implementation: 'implementation' };
    const to = targets[arg];
    if (!to) ng('戻り先は request / requirements / implementation のいずれかです');
    if (!state) ng('パイプラインは開始されていません');
    if (PHASES.indexOf(to) >= PHASES.indexOf(state.phase)) ng(`現在のフェーズ（${state.phase}）より前にしか戻れません`);
    state.approvals ??= {};
    if (to === 'request') { delete state.approvals.request; delete state.approvals.requirements; }
    if (to === 'requirements') delete state.approvals.requirements;
    move(state, to, 'back');
    ok(`${describe(state)}\n戻った先以降の承認は取り消されました。`);
  }
  default:
    ng('使い方: node .claude/harness/pipeline.mjs <start <機能名>|status|advance|back <request|requirements|implementation>>');
}
