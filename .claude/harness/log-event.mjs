// PreToolUse / PostToolUse / Stop / SubagentStop: AI の意思決定を logs/decisions-YYYY-MM-DD.jsonl に記録する
// 記録の失敗で作業を止めないよう、常に exit 0 で終わる（拒否の判定はガード側の役目）
import { readStdinJson, logDecision, clip, toRel } from './lib.mjs';

const input = readStdinJson();
const event = input.hook_event_name;
const tool = input.tool_name;
const ti = input.tool_input ?? {};
const assistantSource = input.agent_id ? 'subagent' : 'assistant';

// 読み取りだけのツールは意思決定として扱わない
const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'ToolSearch', 'NotebookRead', 'WebFetch', 'WebSearch', 'ListAgents']);

const json = (v, max) => clip(typeof v === 'string' ? v : JSON.stringify(v ?? null), max);
const fileOf = (p) => (p ? toRel(p) ?? p : null);

function summarizeTool() {
  switch (tool) {
    case 'Agent':
    case 'Task':
      return { decision: 'delegate', subagent_type: ti.subagent_type ?? null, description: ti.description ?? null, model: ti.model ?? null, prompt: clip(ti.prompt) };
    case 'SubagentHandback':
      return { decision: 'hand_back' };
    case 'Skill':
      return { decision: 'use_skill', skill: ti.skill ?? null, args: clip(ti.args ?? null, 1000) };
    case 'Write':
      return { decision: 'write_file', file: fileOf(ti.file_path), chars: String(ti.content ?? '').length };
    case 'Edit':
      return { decision: 'edit_file', file: fileOf(ti.file_path), replace_all: Boolean(ti.replace_all), old_string: clip(ti.old_string, 1000), new_string: clip(ti.new_string, 1000) };
    case 'MultiEdit':
      return { decision: 'edit_file', file: fileOf(ti.file_path), edits: Array.isArray(ti.edits) ? ti.edits.length : null };
    case 'NotebookEdit':
      return { decision: 'edit_file', file: fileOf(ti.notebook_path), edit_mode: ti.edit_mode ?? null };
    case 'Bash':
    case 'PowerShell':
      return { decision: 'run_command', command: clip(ti.command, 2000), description: ti.description ?? null };
    case 'AskUserQuestion':
      return { decision: 'ask_user', questions: json(ti.questions, 2000) };
    default:
      return { decision: 'use_tool', input: json(ti, 2000) };
  }
}

function logQuestionAnswer() {
  const raw = input.tool_response;
  let response = raw;
  if (typeof raw === 'string') {
    try { response = JSON.parse(raw); } catch { /* 回答を取り出せない形式はツール結果として記録する */ }
  }
  const answers = response?.answers;
  const selections = answers && typeof answers === 'object' && !Array.isArray(answers) ? Object.values(answers) : [];
  if (selections.length && selections.every((answer) => typeof answer === 'string') && ti.answers == null) {
    // 質問は tool_decision 側に記録する。ここでは質問文をキーとして選択結果を残す。
    logDecision('user_answer', { source: 'user', tool, answers }, input);
  } else {
    logDecision('question_result', { source: 'unknown', tool, result: json(raw, 4000) }, input);
  }
}

try {
  if (event === 'PreToolUse' && tool && !READ_ONLY.has(tool)) {
    logDecision('tool_decision', { source: assistantSource, tool, ...summarizeTool() }, input);
  } else if (event === 'PostToolUse' && tool === 'AskUserQuestion') {
    logQuestionAnswer();
  } else if (event === 'PostToolUse' && tool === 'SubagentHandback') {
    logDecision('subagent_report', { source: 'subagent', tool, message: clip(ti.message ?? null, 8000) }, input);
  } else if (event === 'SubagentStop') {
    // 終了時の文章と SubagentHandback による報告は別のイベントとして扱う。
    logDecision('subagent_stop', { source: 'subagent', closing_text: clip(input.last_assistant_message ?? null, 8000) }, input);
  } else if (event === 'Stop') {
    logDecision('final_response', { source: assistantSource, message: clip(input.last_assistant_message ?? null, 8000) }, input);
  }
} catch {
  // 記録できなくても作業は続ける
}
process.exit(0);
