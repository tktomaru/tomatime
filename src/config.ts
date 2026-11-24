// M-6: 環境変数 TOMATIME_HOST、TOMATIME_PORT の検査と既定値の適用（FR-7）。純粋な関数。

import { isIP } from 'node:net';

export interface ListenConfig {
  readonly host: string;
  readonly port: number;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ListenConfig }
  | { readonly ok: false; readonly invalid: 'TOMATIME_HOST' | 'TOMATIME_PORT' };

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
const PORT_PATTERN = /^[1-9][0-9]{0,4}$/;

/** 環境変数を検査し、既定値を適用する。検査の順は TOMATIME_HOST、TOMATIME_PORT。 */
export function parseConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const hostValue = env['TOMATIME_HOST'];
  let host: string;
  if (hostValue === undefined) {
    host = DEFAULT_HOST;
  } else if (isIP(hostValue) === 0) {
    return { ok: false, invalid: 'TOMATIME_HOST' };
  } else {
    host = hostValue;
  }

  const portValue = env['TOMATIME_PORT'];
  let port: number;
  if (portValue === undefined) {
    port = DEFAULT_PORT;
  } else if (PORT_PATTERN.test(portValue) && Number(portValue) <= MAX_PORT) {
    port = Number(portValue);
  } else {
    return { ok: false, invalid: 'TOMATIME_PORT' };
  }

  return { ok: true, config: { host, port } };
}
