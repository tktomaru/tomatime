// テスト用の共通ヘルパー。サーバーをポート 0 で起動し、時刻の取得元と 1 行の書き込み先を差し替える（TT-3、TS-6）。

import assert from 'node:assert/strict';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import type { Clock } from '../../src/clock.ts';
import type { ErrorLineWriter } from '../../src/handler.ts';
import { createTimeServer } from '../../src/server.ts';

/** ISO 8601 の UTC 文字列をエポックからのミリ秒にする。 */
export function ms(iso: string): number {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) {
    throw new Error(`テストの前提の誤り: 解析できない ISO 文字列 ${iso}`);
  }
  return value;
}

/** 取得元の 1 回分の振る舞い。数値（または任意の値）を返すか、例外を投げる。 */
export type Step = { readonly value: unknown } | { readonly throws: unknown };

export const returns = (value: unknown): Step => ({ value });
export const throws = (thrown: unknown): Step => ({ throws: thrown });

/** 呼び出しの回数を数える取得元。steps を呼ばれた順に使い、最後の要素を以後も使う。 */
export interface CountingClock {
  readonly clock: Clock;
  readonly calls: () => number;
}

export function countingClock(...steps: Step[]): CountingClock {
  if (steps.length === 0) {
    throw new Error('テストの前提の誤り: steps が空');
  }
  let count = 0;
  const clock = (): number => {
    const step = steps[Math.min(count, steps.length - 1)]!;
    count += 1;
    if ('throws' in step) {
      throw step.throws;
    }
    // 数でない値を返す取得元も再現するため、型を合わせて返す
    return step.value as number;
  };
  return { clock, calls: () => count };
}

export interface Harness {
  /** 起動したサーバーの URL（パスを付ける）。 */
  readonly url: (path: string) => string;
  readonly port: number;
  /** 時刻の取得元の呼び出し回数。 */
  readonly calls: () => number;
  /** 書き込み先に渡された文字列（呼ばれた順）。 */
  readonly lines: string[];
  /** サーバーが受け取った要求の request-target（送られたパスの確認用）。 */
  readonly requestUrls: string[];
}

export interface StartOptions {
  /** 書き込み先を差し替える（省略時は lines にためる）。 */
  readonly writeErrorLine?: ErrorLineWriter;
}

/** ポート 0 でサーバーを起動し、テストの終わりに閉じる。 */
export async function startServer(
  t: TestContext,
  source: CountingClock,
  options: StartOptions = {},
): Promise<Harness> {
  const lines: string[] = [];
  const requestUrls: string[] = [];
  const writeErrorLine: ErrorLineWriter =
    options.writeErrorLine ??
    ((line: string): void => {
      lines.push(line);
    });
  const server = createTimeServer({ clock: source.clock, writeErrorLine });
  // 応答には関与せず、受け取った request-target を記録するだけのリスナー
  server.on('request', (req) => {
    requestUrls.push(req.url ?? '');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    port,
    calls: source.calls,
    lines,
    requestUrls,
  };
}

export const CONTENT_TYPE = 'text/plain; charset=utf-8';

/** ヘッダーの組（受け入れ条件の「200 のヘッダー」「500 のヘッダー」「405 のヘッダー」）。 */
export interface HeaderExpect {
  readonly contentLength: string;
  readonly allow?: string;
  readonly date: 'present' | 'absent' | 'any';
}

export const HEADERS_200: HeaderExpect = { contentLength: '19', date: 'any' };
export const HEADERS_500: HeaderExpect = { contentLength: '16', date: 'absent' };
export const HEADERS_405: HeaderExpect = { contentLength: '18', allow: 'GET, HEAD', date: 'any' };

/** 生の TCP で要求を送り、サーバーが接続を閉じるまでに受け取ったバイト列を返す。 */
export function rawRequest(port: number, payload: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.connect(port, '127.0.0.1');
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    let error: unknown = null;
    // サーバーが応答の後に接続を切ると、送信中のデータで ECONNRESET が起きることがある。
    // 受信済みの応答があればそれを使い、何も受け取れていなければ失敗にする
    socket.on('error', (err) => {
      error = err;
    });
    socket.on('close', () => {
      if (chunks.length === 0 && error !== null) {
        reject(error);
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    socket.on('connect', () => {
      // 送り終えたら書き込み側を閉じる（サーバーは応答の後に接続を閉じる）
      socket.end(payload);
    });
  });
}

/** 受信したバイト列をステータス行、ヘッダー、本文に分ける。 */
export function parseRawResponse(raw: Buffer): {
  statusLine: string;
  headers: Map<string, string>;
  body: Buffer;
} {
  const sep = raw.indexOf('\r\n\r\n');
  if (sep < 0) {
    throw new Error(`応答のヘッダーの終わりがない: ${JSON.stringify(raw.toString('latin1'))}`);
  }
  const head = raw.subarray(0, sep).toString('latin1').split('\r\n');
  const headers = new Map<string, string>();
  for (const line of head.slice(1)) {
    const idx = line.indexOf(':');
    headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim());
  }
  const rest = raw.subarray(sep + 4);
  const chunked = headers.get('transfer-encoding')?.toLowerCase() === 'chunked';
  return { statusLine: head[0]!, headers, body: chunked ? decodeChunked(rest) : rest };
}

/** chunked の転送符号を外して本文を返す。終端（長さ 0 のチャンク）がなければ失敗にする。 */
export function decodeChunked(data: Buffer): Buffer {
  const parts: Buffer[] = [];
  let pos = 0;
  for (;;) {
    const lineEnd = data.indexOf('\r\n', pos);
    if (lineEnd < 0) {
      throw new Error(`chunked の終端がない: ${JSON.stringify(data.toString('latin1'))}`);
    }
    const size = Number.parseInt(data.subarray(pos, lineEnd).toString('latin1').split(';')[0]!, 16);
    if (!Number.isInteger(size) || size < 0) {
      throw new Error(`chunked の長さが不正: ${JSON.stringify(data.toString('latin1'))}`);
    }
    pos = lineEnd + 2;
    if (size === 0) {
      return Buffer.concat(parts);
    }
    parts.push(data.subarray(pos, pos + size));
    pos += size + 2;
  }
}

/** 受け入れ条件の「200 / 500 / 405 のヘッダー」を確かめる。 */
export function assertHeaders(res: Response, expected: HeaderExpect): void {
  assert.equal(res.headers.get('content-type'), CONTENT_TYPE);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-length'), expected.contentLength);
  assert.equal(res.headers.get('etag'), null);
  assert.equal(res.headers.get('last-modified'), null);
  assert.equal(res.headers.get('expires'), null);
  assert.equal(res.headers.get('transfer-encoding'), null);
  if (expected.allow !== undefined) {
    assert.equal(res.headers.get('allow'), expected.allow);
  }
  if (expected.date === 'absent') {
    assert.equal(res.headers.get('date'), null);
  } else if (expected.date === 'present') {
    assert.notEqual(res.headers.get('date'), null);
  }
}
