// 起動コマンド（package.json の scripts.start と同じ node src/main.ts）を子プロセスで実行するヘルパー。
// 待ち受けの開始は標準出力の listening: の行で、失敗はプロセスの終了で判定する（実時間を待たない。TT-5）。

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const START_ARGS = ['src/main.ts'];

/** 親の環境変数から TOMATIME_* を除き、指定の値を足した環境を作る（未設定は undefined で表す）。 */
export function childEnv(vars: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('TOMATIME_')) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export interface Started {
  readonly kind: 'listening';
  readonly child: ChildProcess;
  readonly listeningLine: string;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

export interface Exited {
  readonly kind: 'exited';
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** 子プロセスを起動し、listening: の行が出るかプロセスが終了するまで待つ。テストの終わりに必ず止める。 */
export function runStart(
  t: TestContext,
  vars: Readonly<Record<string, string | undefined>>,
): Promise<Started | Exited> {
  const child = spawn(process.execPath, START_ARGS, {
    cwd: REPO_ROOT,
    env: childEnv(vars),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    await closed;
  });
  let out = '';
  let err = '';
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  return new Promise<Started | Exited>((resolve, reject) => {
    let settled = false;
    child.once('error', (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
    child.stdout!.on('data', (chunk: string) => {
      out += chunk;
      if (settled) return;
      // 改行まで届いた行だけを見る
      const completeLines = out.slice(0, Math.max(out.lastIndexOf('\n'), 0)).split('\n');
      const line = completeLines.find((l) => l.startsWith('listening:'));
      if (line !== undefined) {
        settled = true;
        resolve({
          kind: 'listening',
          child,
          listeningLine: line,
          stdout: () => out,
          stderr: () => err,
        });
      }
    });
    child.stderr!.on('data', (chunk: string) => {
      err += chunk;
    });
    child.once('close', (code, signal) => {
      if (!settled) {
        settled = true;
        resolve({ kind: 'exited', code, signal, stdout: out, stderr: err });
      }
    });
  });
}

/** OS に空いているポートを割り当てさせて返す（ポート 0 で待ち受けて閉じる）。 */
export async function freePort(host = '127.0.0.1'): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** 指定のアドレスで待ち受けられるかを確かめる（IPv6 のループバックの有無の判定に使う）。 */
export async function canListen(host: string): Promise<boolean> {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => resolve());
    });
  } catch {
    return false;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return true;
}

/** 子プロセスに渡した環境変数の値を、子プロセスの process.env で読んだ結果（JSON）を返す。 */
export function childSeesEnv(name: string, vars: Readonly<Record<string, string | undefined>>): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['-e', `process.stdout.write(JSON.stringify(process.env[${JSON.stringify(name)}] ?? null))`],
      { cwd: REPO_ROOT, env: childEnv(vars), stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.once('error', reject);
    child.once('close', () => resolve(out));
  });
}

export function lines(text: string): string[] {
  return text.split('\n').map((l) => l.replace(/\r$/, ''));
}
