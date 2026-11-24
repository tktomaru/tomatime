// FR-7、FR-8: 起動コマンド（node src/main.ts）を子プロセスで実行して確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { REPO_ROOT, canListen, childSeesEnv, freePort, lines, runStart } from './helpers/process.ts';
import type { Exited, Started } from './helpers/process.ts';

const TIME_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/;

function expectListening(result: Started | Exited): Started {
  if (result.kind !== 'listening') {
    assert.fail(
      `待ち受けずに終了した（code=${result.code}, signal=${result.signal}）。stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
    );
  }
  return result;
}

function expectExited(result: Started | Exited): Exited {
  if (result.kind !== 'exited') {
    assert.fail(`終了せずに待ち受けた: ${result.listeningLine}`);
  }
  return result;
}

/** 妥当でない設定・待ち受けの失敗の共通の確認。 */
function assertStartupFailed(result: Exited, expectedLine: string): void {
  assert.equal(result.code, 1, `stderr=${JSON.stringify(result.stderr)}`);
  assert.ok(
    lines(result.stderr).includes(expectedLine),
    `標準エラー出力に「${expectedLine}」の行がない: ${JSON.stringify(result.stderr)}`,
  );
  assert.equal(
    lines(result.stdout).some((l) => l.startsWith('listening:')),
    false,
    `標準出力に listening: の行がある: ${JSON.stringify(result.stdout)}`,
  );
}

test('起動コマンドの前提: package.json の scripts.start が node src/main.ts（子プロセスで同じ引数を使う）', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: { start: string };
  };
  assert.equal(pkg.scripts.start, 'node src/main.ts');
});

// ---- FR-7 ----

test('FR-7-AC-1: 環境変数が未設定なら 127.0.0.1:3000 で待ち受け、GET / が 200 で本文が時刻の形式', async (t) => {
  const started = expectListening(await runStart(t, {}));
  assert.equal(started.listeningLine, 'listening: host=127.0.0.1 port=3000');
  const res = await fetch('http://127.0.0.1:3000/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), TIME_PATTERN);
});

test('FR-7-AC-2: TOMATIME_HOST=127.0.0.1、TOMATIME_PORT=<n> で待ち受け、GET / が 200', async (t) => {
  const port = await freePort();
  const started = expectListening(
    await runStart(t, { TOMATIME_HOST: '127.0.0.1', TOMATIME_PORT: String(port) }),
  );
  assert.equal(started.listeningLine, `listening: host=127.0.0.1 port=${port}`);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  await res.arrayBuffer();
});

test('FR-7-AC-3: TOMATIME_HOST 未設定、TOMATIME_PORT=<n> で listening: host=127.0.0.1 port=<n>', async (t) => {
  const port = await freePort();
  const started = expectListening(await runStart(t, { TOMATIME_PORT: String(port) }));
  assert.equal(started.listeningLine, `listening: host=127.0.0.1 port=${port}`);
});

test('FR-7-AC-4: TOMATIME_PORT=65535 で listening: host=127.0.0.1 port=65535', async (t) => {
  const started = expectListening(await runStart(t, { TOMATIME_PORT: '65535' }));
  assert.equal(started.listeningLine, 'listening: host=127.0.0.1 port=65535');
});

const invalidCases: ReadonlyArray<readonly [string, Readonly<Record<string, string>>, string]> = [
  ['FR-7-AC-5', { TOMATIME_PORT: 'abc' }, 'TOMATIME_PORT'],
  ['FR-7-AC-6', { TOMATIME_PORT: '0' }, 'TOMATIME_PORT'],
  ['FR-7-AC-7', { TOMATIME_PORT: '65536' }, 'TOMATIME_PORT'],
  ['FR-7-AC-8', { TOMATIME_PORT: '080' }, 'TOMATIME_PORT'],
  ['FR-7-AC-9', { TOMATIME_PORT: '' }, 'TOMATIME_PORT'],
  ['FR-7-AC-10', { TOMATIME_HOST: 'localhost' }, 'TOMATIME_HOST'],
  ['FR-7-AC-11', { TOMATIME_HOST: '999.0.0.1' }, 'TOMATIME_HOST'],
  ['FR-7-AC-13', { TOMATIME_HOST: '' }, 'TOMATIME_HOST'],
];

for (const [id, vars, invalidName] of invalidCases) {
  test(`${id}: ${JSON.stringify(vars)} では終了コード 1、startup failed: invalid ${invalidName}、listening: の行なし`, async (t) => {
    const [name, value] = Object.entries(vars)[0]!;
    if (value === '') {
      // 空文字列が子プロセスの process.env に空文字列として届く前提を確かめる（設計 7 章のテストの補足）
      assert.equal(await childSeesEnv(name, vars), '""');
    }
    const result = expectExited(await runStart(t, vars));
    assertStartupFailed(result, `startup failed: invalid ${invalidName}`);
  });
}

test('FR-7-AC-12: TOMATIME_HOST=localhost、TOMATIME_PORT=abc では TOMATIME_HOST だけを出して終了コード 1', async (t) => {
  const result = expectExited(await runStart(t, { TOMATIME_HOST: 'localhost', TOMATIME_PORT: 'abc' }));
  assertStartupFailed(result, 'startup failed: invalid TOMATIME_HOST');
  assert.equal(lines(result.stderr).includes('startup failed: invalid TOMATIME_PORT'), false);
});

test('FR-7-AC-14: TOMATIME_HOST=::1 で listening: host=::1 port=<n>、http://[::1]:<n>/ が 200', async (t) => {
  if (!(await canListen('::1'))) {
    t.skip('このマシンでは IPv6 のループバック（::1）で待ち受けられないため飛ばす');
    return;
  }
  const port = await freePort('::1');
  const started = expectListening(await runStart(t, { TOMATIME_HOST: '::1', TOMATIME_PORT: String(port) }));
  assert.equal(started.listeningLine, `listening: host=::1 port=${port}`);
  const res = await fetch(`http://[::1]:${port}/`);
  assert.equal(res.status, 200);
  await res.arrayBuffer();
});

test('FR-7-AC-15: TOMATIME_HOST=0.0.0.0 で listening: host=0.0.0.0 port=<n>、http://127.0.0.1:<n>/ が 200', async (t) => {
  const port = await freePort();
  const started = expectListening(await runStart(t, { TOMATIME_HOST: '0.0.0.0', TOMATIME_PORT: String(port) }));
  assert.equal(started.listeningLine, `listening: host=0.0.0.0 port=${port}`);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  await res.arrayBuffer();
});

// ---- FR-8 ----

test('FR-8-AC-1: 待ち受けた後の GET / が 200 で、応答を受け取った時点でプロセスが終了していない', async (t) => {
  const port = await freePort();
  const started = expectListening(await runStart(t, { TOMATIME_PORT: String(port) }));
  assert.equal(started.listeningLine, `listening: host=127.0.0.1 port=${port}`);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  await res.arrayBuffer();
  assert.equal(started.child.exitCode, null);
  assert.equal(started.child.signalCode, null);
});

/** テストの間だけ 127.0.0.1 のポートをふさぐ。 */
async function occupyPort(t: TestContext): Promise<number> {
  const blocker = net.createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', () => resolve());
  });
  t.after(() => new Promise<void>((resolve) => blocker.close(() => resolve())));
  return (blocker.address() as net.AddressInfo).port;
}

test('FR-8-AC-2: ポートが使用中なら終了コード 1、startup failed: EADDRINUSE host=127.0.0.1 port=<n>', async (t) => {
  const port = await occupyPort(t);
  const result = expectExited(await runStart(t, { TOMATIME_PORT: String(port) }));
  assertStartupFailed(result, `startup failed: EADDRINUSE host=127.0.0.1 port=${port}`);
});

test('FR-8-AC-3: このマシンにないアドレス 192.0.2.1 では終了コード 1、startup failed: EADDRNOTAVAIL', async (t) => {
  const port = await freePort();
  const result = expectExited(await runStart(t, { TOMATIME_HOST: '192.0.2.1', TOMATIME_PORT: String(port) }));
  assertStartupFailed(result, `startup failed: EADDRNOTAVAIL host=192.0.2.1 port=${port}`);
});
