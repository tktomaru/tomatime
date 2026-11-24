// M-3: 500 の原因と、標準エラー出力へ書く 1 行の組み立て（FR-4、FR-10）。
// 1 行に発生時刻と取得元が返した値を含めない。

export type TimeFailure =
  | { readonly kind: 'source-threw'; readonly thrown: unknown } // 取得元が例外を投げた
  | { readonly kind: 'non-finite' } // 取得元が有限の数でない値を返した
  | { readonly kind: 'out-of-range' } // 日本時間が有効範囲外
  | { readonly kind: 'internal'; readonly thrown: unknown }; // 換算・整形・応答の作成での例外

/** CR・LF を 1 文字ずつ半角空白に置き換える。ほかの文字は変えない。 */
function oneLine(value: string): string {
  return value.replace(/[\r\n]/g, ' ');
}

function describeError(err: Error): string {
  return `${oneLine(String(err.name))}: ${oneLine(String(err.message))}`;
}

function cause(failure: TimeFailure): string {
  switch (failure.kind) {
    case 'source-threw':
      return failure.thrown instanceof Error
        ? `source threw ${describeError(failure.thrown)}`
        : 'source threw non-error value';
    case 'non-finite':
      return 'source returned non-finite value';
    case 'out-of-range':
      return 'source returned out-of-range value';
    case 'internal':
      return failure.thrown instanceof Error
        ? `internal error ${describeError(failure.thrown)}`
        : 'internal error non-error value';
  }
}

/** `time unavailable: <原因>` と LF の 1 行を返す。 */
export function failureLine(failure: TimeFailure): string {
  return `time unavailable: ${cause(failure)}\n`;
}
