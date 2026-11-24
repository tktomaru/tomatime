// PreToolUse（Edit / Write など）: ハーネスの保護と、エージェント別・フェーズ別の書き込み制限
import { readStdinJson, toRel, isUnlocked, block, loadState, isActive, SEQ_DIR, SEQ_FILE } from './lib.mjs';

const input = readStdinJson();
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
const agent = String(input.agent_type ?? '');
const rel = toRel(target);

if (agent === 'code-reviewer') block(`code-reviewer は読み取り専用のため、ファイルを書き込めません: ${target}`, input);
// プロジェクト外（メモリやスクラッチパッドなど）は対象外
if (rel === null) process.exit(0);

// ハーネス自身の保護。ユーザーが .claude/harness/unlock を置いたときだけ解除する
if (/^\.claude\/(state|harness)\//.test(rel) || /^\.claude\/settings(\.local)?\.json$/.test(rel)) {
  if (isUnlocked()) process.exit(0);
  block(`ハーネスのファイル（${rel}）は変更できません。変更が必要ならユーザーに依頼してください。`, input);
}

// 意思決定ログはフックだけが追記する。AI による書き換え・削除は認めない
if (/^logs\//.test(rel)) {
  if (isUnlocked()) process.exit(0);
  block(`意思決定ログ（${rel}）はハーネスが自動で記録するため、直接書き込めません。`, input);
}

// docs/ 配下の名前の決まり（docs/README.md）: フォルダは NNN_<名前>、ファイルは README.md か NNN_<名前>.md
if (/^docs\//.test(rel)) {
  const parts = rel.split('/').slice(1);
  const file = parts.pop();
  const badDir = parts.find((d) => !SEQ_DIR.test(d));
  if (badDir) block(`docs/ 配下のフォルダ名は 3 桁の連番 + 英小文字・数字・ハイフン（例: 001_requests、001_time-server）にしてください: ${rel}（docs/README.md を参照）`, input);
  if (!(file === 'README.md' || file === '.gitkeep' || SEQ_FILE.test(file))) {
    block(`docs/ 配下のファイル名は README.md か、3 桁の連番 + 章の見出し + .md（例: 001_背景・目的.md。空白は使わない）にしてください: ${rel}（docs/README.md を参照）`, input);
  }
}

// エージェントごとの担当範囲
const agentAllow = {
  'request-analyst': /^docs\/001_requests\//,
  'requirements-engineer': /^docs\/002_requirements\//,
  'software-designer': /^docs\/003_designs\//,
  'test-engineer': /^test\//,
};
if (agentAllow[agent] && !agentAllow[agent].test(rel)) {
  block(`${agent} が書き込めるのは担当範囲（${agentAllow[agent].source}）だけです: ${rel}`, input);
}
if (agent === 'ts-developer' && (/^test\//.test(rel) || /^docs\//.test(rel))) {
  block(`ts-developer は test/ と docs/ に書き込めません（設計書は software-designer、テストは test-engineer の担当）: ${rel}`, input);
}

// フェーズごとの制限
// const state = loadState();
// if (!isActive(state)) process.exit(0);
// const phaseAllow = {
//   request: /^docs\/001_requests\//,
//   request_review: /^docs\/001_requests\//,
//   requirements: /^docs\/002_requirements\//,
//   requirements_review: /^docs\/002_requirements\//,
// };
// const allow = phaseAllow[state.phase];
// if (allow && !allow.test(rel)) {
//   block(`フェーズ「${state.phase}」で書き込めるのは ${allow.source} の下だけです: ${rel}`, input);
// }
// if (state.phase === 'implementation' && /^docs\/(001_requests|002_requirements)\//.test(rel)) {
//   block(`承認済みの要求書・要件定義書は実装テスト中に変更できません: ${rel}。変更が必要なら pipeline.mjs back requirements（または back request）でフェーズを戻し、承認を取り直してください。`, input);
// }
// process.exit(0);
