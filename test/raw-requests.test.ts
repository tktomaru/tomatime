// FR-6: Node.js の http が要求の処理の前に返す既定のエラー応答。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countingClock,
  ms,
  parseRawResponse,
  rawRequest,
  returns,
  startServer,
} from './helpers/server.ts';

const FIXED = '2026-11-25T03:04:05.000Z';

test('FR-6-AC-1: 8,000 文字の X-Long ヘッダーを付けた GET / は 200、本文 2026-11-25 12:04:05', async (t) => {
  const h = await startServer(t, countingClock(returns(ms(FIXED))));
  const res = await fetch(h.url('/'), { headers: { 'X-Long': 'a'.repeat(8000) } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '2026-11-25 12:04:05');
});

const rawCases: ReadonlyArray<readonly [string, string, (port: number) => string, string]> = [
  [
    'FR-6-AC-2',
    '17,000 文字の X-Long ヘッダー',
    (port) => `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Long: ${'a'.repeat(17000)}\r\n\r\n`,
    'HTTP/1.1 431 Request Header Fields Too Large',
  ],
  ['FR-6-AC-3', 'GARBAGE と CRLF 2 つ', () => 'GARBAGE\r\n\r\n', 'HTTP/1.1 400 Bad Request'],
  ['FR-6-AC-4', 'Host なしの GET / HTTP/1.1', () => 'GET / HTTP/1.1\r\n\r\n', 'HTTP/1.1 400 Bad Request'],
  [
    'FR-6-AC-5',
    'Expect: foo',
    (port) => `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nExpect: foo\r\n\r\n`,
    'HTTP/1.1 417 Expectation Failed',
  ],
];

for (const [id, label, build, statusLine] of rawCases) {
  test(`${id}: TCP で直接 ${label} を送ると「${statusLine}」、本文 0 バイト、取得元を呼ばない`, async (t) => {
    const h = await startServer(t, countingClock(returns(ms(FIXED))));
    const raw = await rawRequest(h.port, build(h.port));
    const parsed = parseRawResponse(raw);
    assert.equal(parsed.statusLine, statusLine);
    // 本文の長さは転送符号（Node.js の既定で付く chunked）を外して数える
    assert.equal(parsed.body.length, 0);
    const contentLength = parsed.headers.get('content-length');
    assert.ok(contentLength === undefined || contentLength === '0', `Content-Length: ${contentLength}`);
    // 本文・ヘッダーに日本時間の時刻の形式が入っていない
    assert.doesNotMatch(raw.toString('latin1'), /[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/);
    assert.equal(h.calls(), 0);
    assert.equal(h.lines.join(''), '');
  });
}
