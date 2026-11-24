// ハーネス共通処理（依存なし）
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_PATH = path.join(PROJECT_DIR, '.claude', 'state', 'pipeline.json');
export const UNLOCK_PATH = path.join(PROJECT_DIR, '.claude', 'harness', 'unlock');

export const PHASES = ['request', 'request_review', 'requirements', 'requirements_review', 'implementation', 'done'];

export const PHASE_INFO = {
  request: { label: '要求', next: 'request-analyst に要求書を書かせ、advance する' },
  request_review: { label: '要求のレビュー（人）', next: 'ユーザーに要求書を示し、「承認」の返信を待つ' },
  requirements: { label: '要件定義', next: 'requirements-definition スキルで requirements-engineer に要件定義書を書かせ、advance する' },
  requirements_review: { label: '要件定義のレビュー（人）', next: 'ユーザーに要件定義書を示し、「承認」の返信を待つ' },
  implementation: { label: '実装テスト', next: 'implement-test スキルで実装・テスト・レビューを行い、advance する' },
  done: { label: '完了', next: 'なし' },
};

// レビューフェーズ → 承認対象の文書の種類と、承認後に使うスキル
export const REVIEWS = {
  request_review: { kind: 'request', nextSkill: 'requirements-definition' },
  requirements_review: { kind: 'requirements', nextSkill: 'implement-test' },
};

// 文書の種類 → docs/ 直下のフォルダ（作業の順に番号を振る）。1 つの文書は <フォルダ>/<NNN>_<機能名>/ に章ごとのファイルで置く
export const DOC_KINDS = {
  request: { dir: 'docs/001_requests', label: '要求書' },
  requirements: { dir: 'docs/002_requirements', label: '要件定義書' },
  design: { dir: 'docs/003_designs', label: '設計書' },
  review: { dir: 'docs/004_reviews', label: 'レビュー結果' },
};

// docs/ 配下の名前の決まり（guard-write.mjs と pipeline.mjs が使う）
// フォルダ: 3 桁の連番 + 英小文字・数字・ハイフン（機能名をパイプラインと共有するため ASCII）
// 章ファイル: 3 桁の連番 + 章の見出し（日本語）+ .md。空白と Windows で使えない文字は不可
export const SEQ_DIR = /^\d{3}_[a-z0-9][a-z0-9-]*$/;
export const SEQ_FILE = /^\d{3}_[^\s\\/:*?"<>|]+\.md$/;

const subdirs = (rel) => {
  const abs = path.join(PROJECT_DIR, rel);
  return existsSync(abs) ? readdirSync(abs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
};

// 機能の番号（3 桁）。要求書のフォルダ docs/001_requests/<NNN>_<機能名> で決まり、ほかの文書も同じ番号を使う
// 要求書のフォルダがまだなければ、既存の最大番号 + 1
export function featureNo(feature) {
  const names = subdirs(DOC_KINDS.request.dir).filter((n) => SEQ_DIR.test(n));
  const hit = names.find((n) => n.slice(4) === feature);
  if (hit) return hit.slice(0, 3);
  const max = Math.max(0, ...names.map((n) => Number(n.slice(0, 3))));
  return String(max + 1).padStart(3, '0');
}

// 文書のフォルダ（プロジェクトからの相対パス、末尾の / なし）
export const docDir = (kind, feature) => `${DOC_KINDS[kind].dir}/${featureNo(feature)}_${feature}`;

// フォルダ直下のファイル名（昇順）。フォルダがなければ null
export function docFiles(relDir) {
  const abs = path.join(PROJECT_DIR, relDir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return null;
  return readdirSync(abs, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort();
}

export function readStdinJson() {
  try {
    const s = readFileSync(0, 'utf8');
    return s.trim() ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

export function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function saveState(state) {
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export const isActive = (s) => Boolean(s && s.phase && s.phase !== 'done');

// 文書（フォルダ）の章ファイル NNN_*.md を番号順に連結した本文。章ファイルがなければ null
export function readDoc(relDir) {
  const chapters = (docFiles(relDir) ?? []).filter((n) => SEQ_FILE.test(n));
  if (chapters.length === 0) return null;
  return chapters.map((n) => readFileSync(path.join(PROJECT_DIR, relDir, n), 'utf8')).join('\n');
}

// 文書（フォルダ）のハッシュ。README.md を含む直下の全ファイルの名前と内容から計算する（追加・削除・改名も検出する）
export function docHash(relDir) {
  const names = docFiles(relDir);
  if (!names || names.length === 0) return null;
  const h = createHash('sha256');
  for (const n of names) h.update(n).update('\0').update(readFileSync(path.join(PROJECT_DIR, relDir, n))).update('\0');
  return h.digest('hex');
}

// 文書（フォルダ）の形の検査。README.md と、001 から欠番のない章ファイル NNN_<名前>.md があること
export function checkDocShape(relDir) {
  const names = docFiles(relDir);
  if (names === null) return `${relDir}/ がありません`;
  if (!names.includes('README.md')) return `${relDir}/README.md（表題と章の目次）がありません`;
  const bad = names.filter((n) => n !== 'README.md' && !SEQ_FILE.test(n));
  if (bad.length) return `${relDir}/ に名前の決まり（NNN_<章の見出し>.md）に合わないファイルがあります: ${bad.join(', ')}`;
  const nos = names.filter((n) => SEQ_FILE.test(n)).map((n) => Number(n.slice(0, 3)));
  if (nos.length === 0) return `${relDir}/ に章ファイル（001_<章の見出し>.md など）がありません`;
  const gap = nos.findIndex((no, i) => no !== i + 1);
  if (gap !== -1) return `${relDir}/ の章ファイルの番号が 001 からの連番になっていません（${String(gap + 1).padStart(3, '0')} がない、または重複）`;
  // ファイル名は「NNN_」+ 最初の「## 」見出し + 「.md」と一致させる（日本語の見出しをそのまま使う）
  const mismatch = names.filter((n) => SEQ_FILE.test(n)).filter((n) => {
    const h = readFileSync(path.join(PROJECT_DIR, relDir, n), 'utf8').match(/^## (.+)$/m)?.[1].trim();
    return `${n.slice(0, 4)}${h}.md` !== n;
  });
  if (mismatch.length) return `${relDir}/ に、ファイル名が章の見出し（最初の「## 」行）と一致しない章ファイルがあります（NNN_<見出し>.md にする）: ${mismatch.join(', ')}`;
  return null;
}

// プロジェクト内ならスラッシュ区切りの相対パス、外なら null
export function toRel(p) {
  if (!p) return null;
  const abs = path.resolve(PROJECT_DIR, p);
  const rel = path.relative(PROJECT_DIR, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export const isUnlocked = () => existsSync(UNLOCK_PATH);

// PreToolUse で操作を拒否する（exit 2 + stderr が Claude に返る）
// input を渡すと、拒否した事実を意思決定ログに残す
export function block(message, input) {
  if (input) {
    const ti = input.tool_input ?? {};
    logDecision('blocked', {
      tool: input.tool_name ?? null,
      target: clip(ti.file_path ?? ti.notebook_path ?? ti.command ?? null, 1000),
      reason: message,
    }, input);
  }
  process.stderr.write(message + '\n');
  process.exit(2);
}

// ---- 意思決定ログ（logs/decisions-YYYY-MM-DD.jsonl に 1 行 1 イベントで追記） ----
export const LOG_DIR = path.join(PROJECT_DIR, 'logs');
const MAX_TEXT = 4000;

export function clip(v, max = MAX_TEXT) {
  if (typeof v !== 'string') return v;
  return v.length > max ? `${v.slice(0, max)}…（${v.length} 文字中 ${max} 文字まで）` : v;
}

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ログの失敗でフックやパイプラインを止めない
export function logDecision(event, fields = {}, input = {}) {
  try {
    const state = loadState();
    const source = fields.source ?? 'harness';
    const entry = {
      at: new Date().toISOString(),
      event,
      source,
      hook_event: input.hook_event_name ?? null,
      session_id: input.session_id ?? null,
      prompt_id: input.prompt_id ?? null,
      tool_use_id: input.tool_use_id ?? null,
      agent: input.agent_type || (source === 'assistant' ? 'main' : null),
      agent_id: input.agent_id ?? null,
      feature: state?.feature ?? null,
      phase: state?.phase ?? null,
      ...fields,
    };
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(path.join(LOG_DIR, `decisions-${localDate()}.jsonl`), JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // 記録できなくても処理は続ける
  }
}
