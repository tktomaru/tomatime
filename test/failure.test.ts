// FR-4: 時刻を取得・整形できないときの応答と、標準エラー出力（差し替えた書き込み先）の 1 行。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADERS_200,
  HEADERS_500,
  assertHeaders,
  countingClock,
  ms,
  returns,
  startServer,
  throws,
} from './helpers/server.ts';

const FIXED = '2026-11-25T03:04:05.000Z';
const FIXED_TEXT = '2026-11-25 12:04:05';

/** 500 の応答を確かめる（500 のヘッダー、本文 time unavailable）。 */
async function assert500(res: Response): Promise<void> {
  assert.equal(res.status, 500);
  assertHeaders(res, HEADERS_500);
  const body = await res.text();
  assert.equal(body, 'time unavailable');
  // 時刻らしい値（数字）を本文に含めない
  assert.doesNotMatch(body, /[0-9]/);
}

test('FR-4-AC-1: 取得元が例外を投げると GET / は 500、500 のヘッダー、本文 time unavailable', async (t) => {
  const h = await startServer(t, countingClock(throws(new Error('clock read failed'))));
  await assert500(await fetch(h.url('/')));
  assert.equal(h.calls(), 1);
});

test('FR-4-AC-2: 取得元が NaN を返すと GET / は 500、500 のヘッダー、本文 time unavailable', async (t) => {
  const h = await startServer(t, countingClock(returns(Number.NaN)));
  await assert500(await fetch(h.url('/')));
});

test('FR-4-AC-3: UTC 9999-12-31T14:59:59.999Z（有効範囲の上端）の GET / は 200、本文 9999-12-31 23:59:59', async (t) => {
  const h = await startServer(t, countingClock(returns(ms('9999-12-31T14:59:59.999Z'))));
  const res = await fetch(h.url('/'));
  assert.equal(res.status, 200);
  assertHeaders(res, HEADERS_200);
  assert.equal(await res.text(), '9999-12-31 23:59:59');
});

test('FR-4-AC-4: UTC 9999-12-31T15:00:00.000Z（日本時間で 10000 年）の GET / は 500、本文 time unavailable', async (t) => {
  const h = await startServer(t, countingClock(returns(ms('9999-12-31T15:00:00.000Z'))));
  await assert500(await fetch(h.url('/')));
});

test('FR-4-AC-5: UTC 0000-12-31T15:00:00.000Z（有効範囲の下端）の GET / は 200、本文 0001-01-01 00:00:00', async (t) => {
  const h = await startServer(t, countingClock(returns(ms('0000-12-31T15:00:00.000Z'))));
  const res = await fetch(h.url('/'));
  assert.equal(res.status, 200);
  assertHeaders(res, HEADERS_200);
  assert.equal(await res.text(), '0001-01-01 00:00:00');
});

test('FR-4-AC-6: UTC 0000-12-31T14:59:59.999Z（日本時間で 0 年）の GET / は 500、本文 time unavailable', async (t) => {
  const h = await startServer(t, countingClock(returns(ms('0000-12-31T14:59:59.999Z'))));
  await assert500(await fetch(h.url('/')));
});

test('FR-4-AC-7: 1 回目 200 の後、2 回目に取得元が例外を投げると 500（前回の値を返さない）', async (t) => {
  const h = await startServer(
    t,
    countingClock(returns(ms(FIXED)), throws(new Error('clock read failed'))),
  );
  const first = await fetch(h.url('/'));
  assert.equal(first.status, 200);
  assert.equal(await first.text(), FIXED_TEXT);
  await assert500(await fetch(h.url('/')));
  assert.equal(h.calls(), 2);
});

test('FR-4-AC-8: 1 回目に取得元が例外を投げて 500 の後、2 回目は 200、本文 2026-11-25 12:04:05', async (t) => {
  const h = await startServer(
    t,
    countingClock(throws(new Error('clock read failed')), returns(ms(FIXED))),
  );
  const first = await fetch(h.url('/'));
  assert.equal(first.status, 500);
  assert.equal(await first.text(), 'time unavailable');
  const second = await fetch(h.url('/'));
  assert.equal(second.status, 200);
  assert.equal(await second.text(), FIXED_TEXT);
});

test('FR-4-AC-9: 取得元が Infinity / -Infinity を返すと、2 件とも 500、500 のヘッダー、本文 time unavailable', async (t) => {
  for (const value of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    await t.test(String(value), async (st) => {
      const h = await startServer(st, countingClock(returns(value)));
      await assert500(await fetch(h.url('/')));
    });
  }
});

/** 1 行の書き込みを含めて確かめる受け入れ条件（Given の取得元、期待する 1 行）。 */
const lineCases: ReadonlyArray<readonly [string, string, ReturnType<typeof countingClock>, string]> = [
  [
    'FR-4-AC-10',
    "new Error('clock read failed') を投げる",
    countingClock(throws(new Error('clock read failed'))),
    'time unavailable: source threw Error: clock read failed\n',
  ],
  [
    'FR-4-AC-11',
    '改行を含むメッセージの Error を投げる',
    countingClock(throws(new Error('line1\nline2\r\nline3'))),
    'time unavailable: source threw Error: line1 line2  line3\n',
  ],
  [
    'FR-4-AC-12',
    "Error でない文字列 'boom' を投げる",
    countingClock(throws('boom')),
    'time unavailable: source threw non-error value\n',
  ],
  [
    'FR-4-AC-13',
    'NaN を返す',
    countingClock(returns(Number.NaN)),
    'time unavailable: source returned non-finite value\n',
  ],
  [
    'FR-4-AC-14',
    'UTC 9999-12-31T15:00:00.000Z を返す',
    countingClock(returns(ms('9999-12-31T15:00:00.000Z'))),
    'time unavailable: source returned out-of-range value\n',
  ],
  [
    'FR-4-AC-15',
    "メッセージが空の new TypeError('') を投げる",
    countingClock(throws(new TypeError(''))),
    'time unavailable: source threw TypeError: \n',
  ],
];

for (const [id, given, source, expectedLine] of lineCases) {
  test(`${id}: 取得元が${given}と、GET / は 500 で、書き込まれた 1 行が完全一致`, async (t) => {
    const h = await startServer(t, source);
    const res = await fetch(h.url('/'));
    assert.equal(res.status, 500);
    assert.equal(await res.text(), 'time unavailable');
    assert.equal(h.lines.join(''), expectedLine);
    // 1 件の 500 につき 1 回、1 行全体を渡す（設計 M-4 の ErrorLineWriter）
    assert.equal(h.lines.length, 1);
  });
}

test('FR-4-AC-16: 書き込み先が例外を投げても 1 回目は 500、2 回目は 200 で処理を続ける', async (t) => {
  let writeAttempts = 0;
  const h = await startServer(
    t,
    countingClock(throws(new Error('clock read failed')), returns(ms(FIXED))),
    {
      writeErrorLine: () => {
        writeAttempts += 1;
        throw new Error('stderr write failed');
      },
    },
  );
  await assert500(await fetch(h.url('/')));
  const second = await fetch(h.url('/'));
  assert.equal(second.status, 200);
  assert.equal(await second.text(), FIXED_TEXT);
  // 書き込みの失敗が再現されていること（書き込み先が呼ばれたこと）
  assert.equal(writeAttempts, 1);
});

test('FR-4-AC-17: GET / の 200 と POST / の 405 では、書き込み先が呼ばれない', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const get = await fetch(h.url('/'));
  assert.equal(get.status, 200);
  await get.arrayBuffer();
  assert.equal(h.lines.join(''), '');
  const post = await fetch(h.url('/'), { method: 'POST' });
  assert.equal(post.status, 405);
  await post.arrayBuffer();
  assert.equal(h.lines.join(''), '');
  assert.equal(h.lines.length, 0);
});
