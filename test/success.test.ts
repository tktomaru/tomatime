// FR-1、FR-2、FR-3、NFR-5: 時刻を取得・整形できるときの GET の応答。

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

// ---- FR-1 ----

test('FR-1-AC-1: UTC 2026-11-25T03:04:05Z の GET / は 200、200 のヘッダー、本文 2026-11-25 12:04:05', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const res = await fetch(h.url('/'));
  assert.equal(res.status, 200);
  assertHeaders(res, HEADERS_200);
  assert.equal(await res.text(), FIXED_TEXT);
  assert.equal(h.calls(), 1);
});

const boundaryCases: ReadonlyArray<readonly [string, string, string]> = [
  ['FR-1-AC-2', '2026-01-04T23:02:03.000Z', '2026-01-05 08:02:03'], // 1 桁の月・日・時・分・秒、日をまたぐ
  ['FR-1-AC-3', '2026-07-08T04:09:01.000Z', '2026-07-08 13:09:01'], // 13 時台（24 時間表記）
  ['FR-1-AC-4', '2026-03-15T15:00:00.000Z', '2026-03-16 00:00:00'], // 日をまたぐ境界の瞬間
  ['FR-1-AC-5', '2026-04-30T15:00:00.000Z', '2026-05-01 00:00:00'], // 月末から月をまたぐ
  ['FR-1-AC-6', '2028-02-28T15:00:00.000Z', '2028-02-29 00:00:00'], // うるう年の 2 月 29 日
  ['FR-1-AC-7', '2028-02-29T15:30:00.000Z', '2028-03-01 00:30:00'], // うるう年の 2 月から 3 月へ
  ['FR-1-AC-8', '2026-12-31T15:00:00.000Z', '2027-01-01 00:00:00'], // 年をまたぐ
  ['FR-1-AC-9', '2026-12-31T14:59:59.999Z', '2026-12-31 23:59:59'], // 秒未満の切り捨てで年をまたがない
];

for (const [id, iso, expected] of boundaryCases) {
  test(`${id}: UTC ${iso} の GET / は 200、本文 ${expected}`, async (t) => {
    const h = await startServer(t, countingClock(returns(ms(iso))));
    const res = await fetch(h.url('/'));
    assert.equal(res.status, 200);
    assertHeaders(res, HEADERS_200);
    assert.equal(await res.text(), expected);
  });
}

test('FR-1-AC-10: 順に送った 2 回の GET / は、それぞれその時点で取得した時刻を返し、取得元を 2 回呼ぶ', async (t) => {
  const h = await startServer(
    t,
    countingClock(returns(ms('2026-11-25T03:04:05.000Z')), returns(ms('2026-11-25T03:20:00.000Z'))),
  );
  const first = await fetch(h.url('/'));
  assert.equal(first.status, 200);
  assertHeaders(first, HEADERS_200);
  assert.equal(await first.text(), '2026-11-25 12:04:05');
  const second = await fetch(h.url('/'));
  assert.equal(second.status, 200);
  assertHeaders(second, HEADERS_200);
  assert.equal(await second.text(), '2026-11-25 12:20:00');
  assert.equal(h.calls(), 2);
});

test('FR-1-AC-11: 応答を待たずに続けて送った 2 回の GET / は、ともに 200 で本文の組が一致する（順不同）', async (t) => {
  const h = await startServer(
    t,
    countingClock(returns(ms('2026-11-25T03:04:05.000Z')), returns(ms('2026-11-25T03:04:06.000Z'))),
  );
  const [a, b] = await Promise.all([fetch(h.url('/')), fetch(h.url('/'))]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const bodies = [await a.text(), await b.text()].sort();
  assert.deepEqual(bodies, ['2026-11-25 12:04:05', '2026-11-25 12:04:06']);
  assert.equal(h.calls(), 2);
});

test('FR-1-AC-12: TZ を UTC、Asia/Tokyo、America/New_York に切り替えても本文は 2026-11-25 12:04:05', async (t) => {
  const original = process.env['TZ'];
  t.after(() => {
    if (original === undefined) {
      delete process.env['TZ'];
    } else {
      process.env['TZ'] = original;
    }
  });
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  // 本番コードと違い、ローカル時刻の getter は TZ で結果が変わる。切り替えが効いていることを併せて確かめる
  const localHours: number[] = [];
  for (const tz of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
    process.env['TZ'] = tz;
    localHours.push(new Date(ms(FIXED)).getHours());
    const res = await fetch(h.url('/'));
    assert.equal(res.status, 200, `TZ=${tz}`);
    assert.equal(await res.text(), FIXED_TEXT, `TZ=${tz}`);
  }
  assert.deepEqual(localHours, [3, 12, 22], 'TZ の切り替えがプロセスに反映されていない');
});

test('FR-1-AC-13: 取得元が例外を投げると GET / は 500、500 のヘッダー、本文 time unavailable', async (t) => {
  const h = await startServer(t, countingClock(throws(new Error('clock read failed'))));
  const res = await fetch(h.url('/'));
  assert.equal(res.status, 500);
  assertHeaders(res, HEADERS_500);
  assert.equal(await res.text(), 'time unavailable');
});

// ---- FR-2 ----

test('FR-2-AC-1: GET /now は 200、200 のヘッダー、本文 2026-11-25 12:04:05', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const res = await fetch(h.url('/now'));
  assert.equal(res.status, 200);
  assertHeaders(res, HEADERS_200);
  assert.equal(await res.text(), FIXED_TEXT);
  assert.deepEqual(h.requestUrls, ['/now']);
});

test('FR-2-AC-2: GET /a/b/c/ は 200、本文 2026-11-25 12:04:05', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const res = await fetch(h.url('/a/b/c/'));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), FIXED_TEXT);
  assert.deepEqual(h.requestUrls, ['/a/b/c/']);
});

test('FR-2-AC-3: 不正なパーセントエンコードの GET /%ZZ は 200、本文 2026-11-25 12:04:05', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const res = await fetch(h.url('/%ZZ'));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), FIXED_TEXT);
  assert.deepEqual(h.requestUrls, ['/%ZZ']);
});

test('FR-2-AC-4: 8,000 文字のパスへの GET は 200、本文 2026-11-25 12:04:05', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const path = '/' + 'a'.repeat(7999);
  assert.equal(path.length, 8000);
  const res = await fetch(h.url(path));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), FIXED_TEXT);
  assert.deepEqual(h.requestUrls, [path]);
});

test('FR-2-AC-5: 取得元が例外を投げると GET /now は 500、500 のヘッダー、本文 time unavailable', async (t) => {
  const h = await startServer(t, countingClock(throws(new Error('clock read failed'))));
  const res = await fetch(h.url('/now'));
  assert.equal(res.status, 500);
  assertHeaders(res, HEADERS_500);
  assert.equal(await res.text(), 'time unavailable');
});

// ---- FR-3 ----

test('FR-3-AC-1: 日時に見えるクエリ ?t=2000-01-01T00:00:00Z を付けても本文は取得元の時刻', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const res = await fetch(h.url('/?t=2000-01-01T00:00:00Z'));
  assert.equal(res.status, 200);
  assertHeaders(res, HEADERS_200);
  assert.equal(await res.text(), FIXED_TEXT);
  assert.deepEqual(h.requestUrls, ['/?t=2000-01-01T00:00:00Z']);
});

const queryCases: ReadonlyArray<readonly [string, string]> = [
  ['FR-3-AC-2', '/?t='],
  ['FR-3-AC-3', '/?t=a&t=b&x=1'],
  ['FR-3-AC-4', '/?t=%ZZ'],
  ['FR-3-AC-5', '/now?'],
];

for (const [id, target] of queryCases) {
  test(`${id}: GET ${target} は 200、本文 2026-11-25 12:04:05`, async (t) => {
    const h = await startServer(t, countingClock(returns(ms(FIXED))));
    const res = await fetch(h.url(target));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), FIXED_TEXT);
    // 送った request-target がそのまま届いていること（fetch が書き換えていないこと）
    assert.deepEqual(h.requestUrls, [target]);
  });
}

test('FR-3-AC-6: 取得元が例外を投げると GET /?t=abc は 500、500 のヘッダー、本文 time unavailable', async (t) => {
  const h = await startServer(t, countingClock(throws(new Error('clock read failed'))));
  const res = await fetch(h.url('/?t=abc'));
  assert.equal(res.status, 500);
  assertHeaders(res, HEADERS_500);
  assert.equal(await res.text(), 'time unavailable');
});

// ---- NFR-5 ----

test('NFR-5: 転送ヘッダーを付けた GET / の応答は、付けない場合とステータス・本文・Content-Type・Cache-Control が一致', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const plain = await fetch(h.url('/'));
  const forwarded = await fetch(h.url('/'), {
    headers: {
      'X-Forwarded-For': '203.0.113.1',
      'X-Forwarded-Proto': 'https',
      'X-Real-IP': '203.0.113.1',
    },
  });
  const summarize = async (res: Response) => ({
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get('content-type'),
    cacheControl: res.headers.get('cache-control'),
  });
  const a = await summarize(plain);
  const b = await summarize(forwarded);
  assert.deepEqual(b, a);
  assert.deepEqual(a, {
    status: 200,
    body: FIXED_TEXT,
    contentType: 'text/plain; charset=utf-8',
    cacheControl: 'no-store',
  });
});
