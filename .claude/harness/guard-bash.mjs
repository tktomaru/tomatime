// PreToolUse（Bash / PowerShell）: ハーネスの状態やファイルを、パイプライン CLI 以外のコマンドで触らせない
import { readStdinJson, isUnlocked, block } from './lib.mjs';

const input = readStdinJson();
const command = String(input.tool_input?.command ?? '').trim();
if (!command || isUnlocked()) process.exit(0);

const pipelineCli = /^node\s+(\.\/)?\.claude[\\/]harness[\\/]pipeline\.mjs(\s+[a-z0-9-]+){0,2}\s*$/;
if (pipelineCli.test(command)) process.exit(0);

const touchesHarness = /\.claude[\\/](state|harness)\b|\.claude[\\/]settings(\.local)?\.json/;
if (touchesHarness.test(command)) {
  block('.claude/state・.claude/harness・settings には、パイプライン CLI（node .claude/harness/pipeline.mjs <サブコマンド>）を単独で実行する以外の方法で触れられません。', input);
}

// 意思決定ログ（logs/）はシェルから触らせない。閲覧は Read ツールで行う
const touchesLogs = /(^|[^\w.-])logs([\\/]|\s|$|["'])/;
if (touchesLogs.test(command)) {
  block('意思決定ログ（logs/）はシェルコマンドで操作できません。内容を見るときは Read ツールを使ってください。', input);
}
process.exit(0);
