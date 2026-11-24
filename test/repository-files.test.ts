// FR-9、FR-12: README.md の節。FR-11: Dockerfile の命令の行。Docker は使わず、ファイルの文字列を読む。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './helpers/process.ts';

function readRepoFile(name: string): string {
  return readFileSync(join(REPO_ROOT, name), 'utf8');
}

/** 見出し `## <title>` の次の行から、次の `## ` 見出しの前の行（なければ末尾）までを返す。節がなければ null。 */
export function section(markdown: string, title: string): string | null {
  const all = markdown.split(/\r?\n/);
  const start = all.findIndex((l) => l === `## ${title}`);
  if (start < 0) return null;
  const rest = all.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/** Dockerfile の命令の行: 前後の空白を除いた行のうち、空行と # で始まる行を除いたもの。 */
export function instructionLines(dockerfile: string): string[] {
  return dockerfile
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

const AI_SECTION = '生成 AI への指示文の例';
const DOCKER_SECTION = 'Docker での起動';

function requireSection(title: string): string {
  const body = section(readRepoFile('README.md'), title);
  assert.notEqual(body, null, `README.md に節「## ${title}」がない`);
  return body!;
}

// ---- FR-9 ----

test('FR-9-AC-1: 指示文の例の節があり、URL の形・毎回異なる・日本時間・形式・推測しないを含む', () => {
  const body = requireSection(AI_SECTION);
  for (const s of ['https://<公開ホスト>/?t=', '毎回異なる', '日本時間', 'YYYY-MM-DD HH:mm:ss', '推測しない']) {
    assert.ok(body.includes(s), `節に「${s}」がない`);
  }
});

test('FR-9-AC-2: 指示文の例の節が、取得できない場合として「200 以外」と「形式でない」を含む', () => {
  const body = requireSection(AI_SECTION);
  assert.ok(body.includes('200 以外'), '節に「200 以外」がない');
  assert.ok(body.includes('形式でない'), '節に「形式でない」がない');
});

test('FR-9-AC-3: 指示文の例の節に、具体的な日付・時刻の値がない', () => {
  const body = requireSection(AI_SECTION);
  assert.doesNotMatch(body, /[0-9]{4}-[0-9]{2}-[0-9]{2}/);
  assert.doesNotMatch(body, /[0-9]{2}:[0-9]{2}:[0-9]{2}/);
});

// ---- FR-11 ----

test('FR-11-AC-1: FROM の行が 1 行以上あり、すべて Node.js 24 以上の公式 node イメージ', () => {
  const froms = instructionLines(readRepoFile('Dockerfile')).filter((l) => l.startsWith('FROM'));
  assert.ok(froms.length >= 1, 'FROM の行がない');
  for (const line of froms) {
    assert.match(line, /^FROM node:(2[4-9]|[3-9][0-9])([.-][^ ]*)?( [Aa][Ss] [^ ]+)?$/);
  }
});

test('FR-11-AC-2: 命令の行に ENV TOMATIME_HOST=0.0.0.0、EXPOSE 3000、USER node がある', () => {
  const ins = instructionLines(readRepoFile('Dockerfile'));
  for (const expected of ['ENV TOMATIME_HOST=0.0.0.0', 'EXPOSE 3000', 'USER node']) {
    assert.ok(ins.includes(expected), `命令の行に「${expected}」がない`);
  }
});

test('FR-11-AC-3: 最後の CMD が exec 形式で node から始まり、つなぐと package.json の scripts.start と一致', () => {
  const cmds = instructionLines(readRepoFile('Dockerfile')).filter((l) => l.startsWith('CMD'));
  assert.ok(cmds.length >= 1, 'CMD の行がない');
  const last = cmds[cmds.length - 1]!;
  assert.ok(last.startsWith('CMD ['), `CMD が exec 形式でない: ${last}`);
  const parsed: unknown = JSON.parse(last.slice('CMD '.length));
  assert.ok(Array.isArray(parsed) && parsed.every((e) => typeof e === 'string'), 'CMD の配列が文字列の配列でない');
  const args = parsed as string[];
  assert.equal(args[0], 'node');
  const pkg = JSON.parse(readRepoFile('package.json')) as { scripts: { start: string } };
  assert.equal(args.join(' '), pkg.scripts.start);
});

test('FR-11-AC-4: TZ を設定する行、TOMATIME_PORT を含む行、/etc/localtime がない', () => {
  const text = readRepoFile('Dockerfile');
  const ins = instructionLines(text);
  assert.deepEqual(ins.filter((l) => /^(ENV|ARG) (.* )?TZ([= ]|$)/.test(l)), []);
  assert.deepEqual(ins.filter((l) => l.includes('TOMATIME_PORT')), []);
  assert.equal(text.includes('/etc/localtime'), false);
});

test('FR-11-AC-5: ENTRYPOINT の行がなく、CMD の行がすべて exec 形式', () => {
  const ins = instructionLines(readRepoFile('Dockerfile'));
  assert.deepEqual(ins.filter((l) => l.startsWith('ENTRYPOINT')), []);
  assert.deepEqual(ins.filter((l) => l.startsWith('CMD') && !l.startsWith('CMD [')), []);
});

// ---- FR-12 ----

test('FR-12-AC-1: Docker での起動の節があり、docker build、docker run、-p 127.0.0.1:3000:3000、docker stop を含む', () => {
  const body = requireSection(DOCKER_SECTION);
  for (const s of ['docker build', 'docker run', '-p 127.0.0.1:3000:3000', 'docker stop']) {
    assert.ok(body.includes(s), `節に「${s}」がない`);
  }
});

test('FR-12-AC-2: Docker での起動の節に、ホストのすべてのアドレスに公開する例がない', () => {
  const body = requireSection(DOCKER_SECTION);
  for (const s of ['-p 3000:3000', '-p 0.0.0.0:', '-P ', '--network host', '--network=host']) {
    assert.equal(body.includes(s), false, `節に「${s}」がある`);
  }
});

// ---- 判定の補助関数の自己確認（節・命令の行の切り出しが誤っていると、上のテストが素通りするため） ----

test('補助: section は次の ## 見出しの前までを切り出し、### は節に含める', () => {
  const md = '# t\n## A\nx\n### sub\ny\n## B\nz\n';
  assert.equal(section(md, 'A'), 'x\n### sub\ny');
  assert.equal(section(md, 'B'), 'z\n');
  assert.equal(section(md, 'C'), null);
});

test('補助: instructionLines は空行とコメントを除き、前後の空白を取る', () => {
  assert.deepEqual(instructionLines('  FROM node:24 \n\n# ENV TZ=x\nCMD ["node"]\r\n'), ['FROM node:24', 'CMD ["node"]']);
});
