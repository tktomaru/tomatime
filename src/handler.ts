// M-4: 1 件の要求の処理（FR-1〜FR-5、FR-10、NFR-1、NFR-3、NFR-5）。
// 読む要求の情報は req.method だけ。時刻と本文はローカル変数だけに置く。

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Clock } from './clock.ts';
import { formatJst } from './format.ts';
import { failureLine } from './failure.ts';
import type { TimeFailure } from './failure.ts';

export type ErrorLineWriter = (line: string) => void;

export interface HandlerDeps {
  readonly clock: Clock;
  readonly writeErrorLine: ErrorLineWriter;
}

const CONTENT_TYPE = 'text/plain; charset=utf-8';
const CACHE_CONTROL = 'no-store';
const ALLOW = 'GET, HEAD';
const BODY_405 = 'method not allowed';
const BODY_500 = 'time unavailable';

/** 送信の前に組み立て終える応答の内容。 */
interface ResponsePlan {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly sendDate: boolean;
}

function baseHeaders(body: string): Record<string, string> {
  return {
    'Content-Type': CONTENT_TYPE,
    'Cache-Control': CACHE_CONTROL,
    'Content-Length': String(Buffer.byteLength(body, 'utf8')),
  };
}

function plan200(text: string): ResponsePlan {
  return { status: 200, headers: baseHeaders(text), body: text, sendDate: true };
}

function plan405(): ResponsePlan {
  return {
    status: 405,
    headers: { ...baseHeaders(BODY_405), Allow: ALLOW },
    body: BODY_405,
    sendDate: true,
  };
}

function plan500(): ResponsePlan {
  return { status: 500, headers: baseHeaders(BODY_500), body: BODY_500, sendDate: false };
}

/** writeHead と end を 1 回ずつ呼ぶ。HEAD は本文を送らない。 */
function send(res: ServerResponse, isHead: boolean, plan: ResponsePlan): void {
  res.sendDate = plan.sendDate;
  res.writeHead(plan.status, plan.headers);
  if (isHead) {
    res.end();
  } else {
    res.end(plan.body);
  }
}

function readAndFormat(
  clock: Clock,
): { ok: true; text: string } | { ok: false; failure: TimeFailure } {
  let raw: unknown;
  try {
    raw = clock();
  } catch (thrown) {
    return { ok: false, failure: { kind: 'source-threw', thrown } };
  }
  const formatted = formatJst(raw); // ここでの例外は呼び出し元の catch で internal になる
  return formatted.ok
    ? { ok: true, text: formatted.text }
    : { ok: false, failure: { kind: formatted.reason } };
}

function fail(
  res: ServerResponse,
  isHead: boolean,
  failure: TimeFailure,
  write: ErrorLineWriter,
): void {
  try {
    write(failureLine(failure));
  } catch {
    // 書き込みの失敗は応答に影響させない
  }
  try {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    send(res, isHead, plan500()); // sendDate = false、本文 time unavailable
  } catch {
    try {
      res.destroy();
    } catch {
      // 何もしない
    }
  }
}

/** http.createServer に渡す要求処理を作る。返す関数は例外を投げ返さない。 */
export function createRequestHandler(
  deps: HandlerDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const isHead = req.method === 'HEAD';
    try {
      if (req.method !== 'GET' && !isHead) {
        send(res, isHead, plan405()); // 取得元を呼ばない
        return;
      }
      const result = readAndFormat(deps.clock); // 取得（専用の try）と整形
      if (!result.ok) {
        fail(res, isHead, result.failure, deps.writeErrorLine);
        return;
      }
      send(res, isHead, plan200(result.text));
    } catch (thrown) {
      fail(res, isHead, { kind: 'internal', thrown }, deps.writeErrorLine);
    }
  };
}
