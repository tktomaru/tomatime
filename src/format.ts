// M-2: 整形。状態を持たない純粋な関数（NFR-1、NFR-2、FR-1、FR-4）。
// ローカル時刻の getter、toLocale*、Intl、Date.UTC は使わない（TS-4）。

export type FormatResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'non-finite' | 'out-of-range' };

/** 日本時間（UTC+9）のオフセット。9 時間のミリ秒。 */
const JST_OFFSET_MS = 32_400_000;

/** 日本時間 0001-01-01 00:00:00 を、UTC の getter で読める形のミリ秒で表した値。 */
const MIN_JST_MS = -62_135_596_800_000;

/** 日本時間 9999-12-31 23:59:59 を、UTC の getter で読める形のミリ秒で表した値。 */
const MAX_JST_MS = 253_402_300_799_000;

const TEXT_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/;

/** 値を検査し、日本時間の `YYYY-MM-DD HH:mm:ss` にする。想定外の例外は投げたままにする。 */
export function formatJst(epochMs: unknown): FormatResult {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) {
    return { ok: false, reason: 'non-finite' };
  }
  const jst = epochMs + JST_OFFSET_MS;
  const sec = Math.floor(jst / 1000) * 1000;
  // Date を作る前に、定数の境界と比べる
  if (!(sec >= MIN_JST_MS && sec <= MAX_JST_MS)) {
    return { ok: false, reason: 'out-of-range' };
  }
  const d = new Date(sec);
  const text =
    String(d.getUTCFullYear()).padStart(4, '0') +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0') +
    ' ' +
    String(d.getUTCHours()).padStart(2, '0') +
    ':' +
    String(d.getUTCMinutes()).padStart(2, '0') +
    ':' +
    String(d.getUTCSeconds()).padStart(2, '0');
  if (!TEXT_PATTERN.test(text)) {
    // 防御のための検査。形式に合わない文字列を本文にしない（TS-5）
    throw new Error('formatted text does not match the expected pattern');
  }
  return { ok: true, text };
}
