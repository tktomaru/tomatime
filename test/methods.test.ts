// FR-5: GET と HEAD 以外のメソッド。FR-10: HEAD。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADERS_200,
  HEADERS_405,
  HEADERS_500,
  assertHeaders,
  countingClock,
  ms,
  returns,
  startServer,
  throws,
} from './helpers/server.ts';

const FIXED = '2026-11-25T03:04:05.000Z';

async function assert405(res: Response): Promise<void> {
  assert.equal(res.status, 405);
  assertHeaders(res, HEADERS_405);
  assert.equal(await res.text(), 'method not allowed');
}

// ---- FR-5 ----

test('FR-5-AC-1: POST / は 405、405 のヘッダー、本文 method not allowed、取得元を呼ばない', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  await assert405(await fetch(h.url('/'), { method: 'POST' }));
  assert.equal(h.calls(), 0);
});

test('FR-5-AC-3: PUT /now?t=1、DELETE /、PATCH /、OPTIONS / は 4 件とも 405、本文 method not allowed', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['PUT', '/now?t=1'],
    ['DELETE', '/'],
    ['PATCH', '/'],
    ['OPTIONS', '/'],
  ];
  for (const [method, path] of cases) {
    await t.test(`${method} ${path}`, async () => {
      await assert405(await fetch(h.url(path), { method }));
    });
  }
  assert.equal(h.calls(), 0);
});

test('FR-5-AC-4: 取得元が例外を投げても POST / は 405（500 にならない）', async (t) => {
  const h = await startServer(t, countingClock(throws(new Error('clock read failed'))));
  await assert405(await fetch(h.url('/'), { method: 'POST' }));
  assert.equal(h.calls(), 0);
  assert.equal(h.lines.join(''), '');
});

// ---- FR-10 ----

async function bodyLength(res: Response): Promise<number> {
  return (await res.arrayBuffer()).byteLength;
}

test('FR-10-AC-1: HEAD / は 200、200 のヘッダー、本文 0 バイト、取得元を 1 回呼ぶ', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const res = await fetch(h.url('/'), { method: 'HEAD' });
  assert.equal(res.status, 200);
  assertHeaders(res, HEADERS_200);
  assert.equal(await bodyLength(res), 0);
  assert.equal(h.calls(), 1);
});

test('FR-10-AC-2: HEAD /now?t=abc は 200、200 のヘッダー、本文 0 バイト', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const res = await fetch(h.url('/now?t=abc'), { method: 'HEAD' });
  assert.equal(res.status, 200);
  assertHeaders(res, HEADERS_200);
  assert.equal(await bodyLength(res), 0);
  assert.deepEqual(h.requestUrls, ['/now?t=abc']);
});

test('FR-10-AC-3: 取得元が例外を投げると HEAD / は 500、500 のヘッダー、本文 0 バイト、1 行が完全一致', async (t) => {
  const h = await startServer(t, countingClock(throws(new Error('clock read failed'))));
  const res = await fetch(h.url('/'), { method: 'HEAD' });
  assert.equal(res.status, 500);
  assertHeaders(res, HEADERS_500);
  assert.equal(await bodyLength(res), 0);
  assert.equal(h.lines.join(''), 'time unavailable: source threw Error: clock read failed\n');
});

test('FR-10-AC-4: 取得元が NaN を返すと HEAD / は 500、500 のヘッダー、本文 0 バイト、1 行が完全一致', async (t) => {
  const h = await startServer(t, countingClock(returns(Number.NaN)));
  const res = await fetch(h.url('/'), { method: 'HEAD' });
  assert.equal(res.status, 500);
  assertHeaders(res, HEADERS_500);
  assert.equal(await bodyLength(res), 0);
  assert.equal(h.lines.join(''), 'time unavailable: source returned non-finite value\n');
});

test('FR-10-AC-5: 有効範囲の上端の HEAD / は 200、上端を超えると 500（いずれも本文 0 バイト）', async (t) => {
  await t.test('UTC 9999-12-31T14:59:59.999Z', async (st) => {
    const h = await startServer(st, countingClock(returns(ms('9999-12-31T14:59:59.999Z'))));
    const res = await fetch(h.url('/'), { method: 'HEAD' });
    assert.equal(res.status, 200);
    assertHeaders(res, HEADERS_200);
    assert.equal(await bodyLength(res), 0);
  });
  await t.test('UTC 9999-12-31T15:00:00.000Z', async (st) => {
    const h = await startServer(st, countingClock(returns(ms('9999-12-31T15:00:00.000Z'))));
    const res = await fetch(h.url('/'), { method: 'HEAD' });
    assert.equal(res.status, 500);
    assertHeaders(res, HEADERS_500);
    assert.equal(await bodyLength(res), 0);
  });
});
