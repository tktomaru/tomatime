// M-5: M-4 の処理を持つ http.Server を作って返す。待ち受け（listen）はしない（CD-2、FR-6）。
// Node.js の既定の設定・イベントの扱いを変えない。

import http from 'node:http';
import type { Server } from 'node:http';
import { createRequestHandler } from './handler.ts';
import type { HandlerDeps } from './handler.ts';

export type TimeServerOptions = HandlerDeps;

/** 待ち受けていない http.Server を返す。 */
export function createTimeServer(options: TimeServerOptions): Server {
  return http.createServer(createRequestHandler(options));
}
