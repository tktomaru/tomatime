// UserPromptSubmit: ユーザーの「承認」「中止」を記録し、現在のフェーズを Claude に伝える（stdout が文脈に入る）
import { readStdinJson, loadState, saveState, isActive, REVIEWS, PHASE_INFO, docDir, docHash, logDecision, clip } from './lib.mjs';

const input = readStdinJson();
let prompt = String(input.prompt ?? '').trim();

// IDE 拡張が先頭に付けた情報を別に記録する。本文中の引用やコードはそのまま残す。
const IDE_CONTEXT = /^<(ide_opened_file|ide_selection)>([\s\S]*?)<\/\1>/;
for (let context = IDE_CONTEXT.exec(prompt); context; context = IDE_CONTEXT.exec(prompt)) {
  logDecision('ide_context', { source: 'ide', kind: context[1], context: clip(context[2].trim()) }, input);
  prompt = prompt.slice(context[0].length).trimStart();
}
if (!prompt) process.exit(0);

// UserPromptSubmit には Claude Code が配送する通知も届くため、人の入力とは別のイベントにする。
const agentMessage = /^<agent-message from="([^"\r\n<>]+)">([\s\S]*?)<\/agent-message>/.exec(prompt);
if (agentMessage?.[0] === prompt) {
  logDecision('agent_message', {
    source: 'subagent', agent: null, agent_id: agentMessage[1], notification: clip(agentMessage[2].trim(), 8000),
  }, input);
  process.exit(0);
}

const taskNotification = /^<task-notification>([\s\S]*?)<\/task-notification>/.exec(prompt);
if (taskNotification?.[0] === prompt) {
  const notification = taskNotification[1];
  logDecision('task_notification', {
    source: 'task',
    task_id: /<task-id>([^<]+)<\/task-id>/.exec(notification)?.[1] ?? null,
    tool_use_id: input.tool_use_id ?? /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(notification)?.[1] ?? null,
    notification: clip(notification.trim()),
  }, input);
  process.exit(0);
}

if (/^<(?:agent-message|task-notification|ide_opened_file|ide_selection)\b/.test(prompt)) {
  logDecision('unattributed_prompt', { source: 'unknown', prompt: clip(prompt) }, input);
  process.exit(0);
}

logDecision('user_prompt', { source: 'user', prompt: clip(prompt) }, input);

const state = loadState();
if (!isActive(state)) process.exit(0);
const f = state.feature;

if (/^(パイプライン)?中止[。.!！]?$/.test(prompt)) {
  state.history.push({ at: new Date().toISOString(), from: state.phase, to: 'done', note: 'ユーザーが中止' });
  state.phase = 'done';
  saveState(state);
  logDecision('pipeline_abort', { source: 'user', by: 'user' }, input);
  console.log(`ユーザーがパイプライン（機能 ${f}）を中止した。フェーズによる書き込み制限は解除された。`);
  process.exit(0);
}

const review = REVIEWS[state.phase];
if (review && /^(承認|approve)[。.!！]?$/i.test(prompt)) {
  const rel = `${docDir(review.kind, f)}/`;
  const hash = docHash(rel);
  if (!hash) {
    logDecision('approval_failed', { source: 'user', by: 'user', doc: rel, reason: '文書が存在しない' }, input);
    console.log(`ユーザーは承認と返信したが、${rel} が存在しない（またはファイルがない）ため承認は記録されていない。`);
    process.exit(0);
  }
  state.approvals ??= {};
  state.approvals[review.kind] = hash;
  saveState(state);
  logDecision('approval', { source: 'user', by: 'user', doc: rel, sha256: hash }, input);
  console.log(
    `ユーザーが ${rel} を承認し、ハーネスが記録した（SHA-256 先頭: ${hash.slice(0, 12)}）。` +
    `node .claude/harness/pipeline.mjs advance を実行し、続けて ${review.nextSkill} スキルを実行すること。`,
  );
  process.exit(0);
}

const lines = [`パイプライン状態: 機能 ${f}、フェーズ ${state.phase}（${PHASE_INFO[state.phase].label}）。`];
if (review) {
  lines.push('この入力は承認ではない（承認は、ユーザーが「承認」とだけ返信した場合に限り記録される）。修正指示や確認事項への回答として扱い、担当エージェントに文書を更新させてから、もう一度レビューを依頼する。');
}
console.log(lines.join('\n'));
