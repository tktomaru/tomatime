// M-7: 起動の入口（npm start と Dockerfile の CMD）。テストから import しない（CD-2）。
// process に触れるのはこのモジュールだけ。出力に時刻を含めない。

import { systemClock } from './clock.ts';
import { parseConfig } from './config.ts';
import { createTimeServer } from './server.ts';

// 標準エラー出力の非同期の書き込み失敗でプロセスが落ちないようにする
process.stderr.on('error', () => {});

function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code: unknown = err.code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return 'UNKNOWN';
}

const parsed = parseConfig(process.env);
if (!parsed.ok) {
  process.stderr.write(`startup failed: invalid ${parsed.invalid}\n`);
  process.exitCode = 1;
} else {
  const { host, port } = parsed.config;
  const server = createTimeServer({
    clock: systemClock,
    writeErrorLine: (line) => {
      process.stderr.write(line);
    },
  });

  // 処理中の要求の完了を待たずに終了する（NFR-6）
  const stop = (): void => {
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const onStartupError = (err: unknown): void => {
    process.stderr.write(`startup failed: ${errorCode(err)} host=${host} port=${port}\n`);
    // process.exit(1) は呼ばない。標準エラー出力の書き込みが切れないよう自然に終了させる
    process.exitCode = 1;
  };

  server.once('error', onStartupError);
  server.once('listening', () => {
    server.off('error', onStartupError);
    process.stdout.write(`listening: host=${host} port=${port}\n`);
  });
  server.listen(port, host);
}
