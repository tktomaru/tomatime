# 実装とテストの共通ルール

対象のエージェント: software-designer（3 章）、ts-developer、test-engineer、code-reviewer。

## 1. 実行環境と構成

| 項目 | 決まり |
|---|---|
| Node.js | 24 以上（開発機は v26）。`package.json` の `engines.node` は `>=24` |
| TypeScript | `strict: true`。Node の型ストリップで `.ts` を直接実行する場合は `erasableSyntaxOnly`、`verbatimModuleSyntax`、`allowImportingTsExtensions` などを整合させる |
| モジュール | ESM（`"type": "module"`） |
| HTTP | `node:http` を基本にする |
| 依存 | 開発依存は `typescript` と `@types/node` を基本にする。ランタイム依存を足すときは要件定義書に根拠を書く |
| ディレクトリ | `src/` 本番コード、`test/` テスト |

## 2. npm スクリプト

パイプラインの完了判定で `npm run typecheck` と `npm test` を実行するので、必ず用意する。

| スクリプト | 内容 |
|---|---|
| `typecheck` | `tsc --noEmit` |
| `test` | `node --test` で `test/**/*.test.ts` を実行する |
| `start` | サーバーを前面で起動する |

## 3. 設計の決まり

| ID | 決まり |
|---|---|
| CD-1 | 時刻の取得元（現在時刻）は、関数やインターフェースで外から差し替えられるようにする |
| CD-2 | 起動（ポートの待ち受け）とリクエスト処理を分け、テストからポート 0 でサーバーを立てられるようにする |
| CD-3 | 要件定義書にない機能・エンドポイントを足さない |
| CD-4 | 例外で落ちても不正な時刻を返さない（[time-safety.md](time-safety.md) の TS-5） |

## 4. テストの決まり

| ID | 決まり |
|---|---|
| TT-1 | `node:test` と `node:assert/strict` を使い、`test/**/*.test.ts` に置く |
| TT-2 | テスト名の先頭に受け入れ条件 ID を入れる（例: `test('FR-1-AC-1: …', ...)`）。ハーネスが検査する |
| TT-3 | HTTP の振る舞いは、ポート 0 で実際にサーバーを起動し、`fetch` で確かめる。`after` / `t.after` で必ず閉じる |
| TT-4 | 本文は固定時刻を注入して完全一致で確かめる |
| TT-5 | 実時間を待たない。`setTimeout` で時間を稼がない |
| TT-6 | テストが本当に失敗しうるか確かめる（期待値を一時的に変えると落ちること） |
