# tomaTime

HTTP でアクセスされたら現在時刻を返すサーバー。呼び出し元は生成 AI で、返した文字列は参考の「現在時刻」として使われる。返す時刻は OS の時計の値で、OS の時計のずれは許容する（重大な不具合にはつながらない）。ただし、OS の時計から取得した値と異なる時刻（キャッシュされた古い値、タイムゾーンの取り違え、例外時の既定値）は返さない。

## 言語
- 回答、生成する文書（要求書、要件定義書、レビュー結果、コメント、コミットメッセージなど）はすべて日本語で書く。サブエージェントも同じ
- 英語は、技術用語、ソースコード、識別子、コマンド、ログやエラーメッセージの引用など、日本語にできないものに限って使う

## 確定している仕様（ユーザー指定）
- 時刻を返す成功応答の本文は [時刻の返却形式の正本](.claude/specs/time-response-format.md) に従う。時刻の返却を扱う作業を始めるときは、リポジトリ上の正本を開く
- 言語・実行環境: TypeScript / Node.js

時刻の返却を扱う作業は、直接依頼する場合も [返却形式を扱う作業の委任](.claude/rules/agents.md#返却形式を扱う作業の委任) に従って委任する。

## 開発の進め方
新しい機能やシステムを作る依頼は、次の 3 つのスキルを順に使う。矢印の箇所で人がレビューし、「承認」と返信するまで次へ進まない。

```
request-intake（重要事項を随時確認しながら要求を整理 → AI 一次レビュー 1 回 → 指摘の反映） → [残る確認事項の提示と人のレビュー] → requirements-definition（要件定義 → AI 一次レビュー 1 回 → 指摘の反映） → [人のレビュー] → implement-test（設計 → 実装 → テスト → レビュー）
```

| 依頼の種類 | エージェント |
|---|---|
| 要求の整理（要求書） | request-analyst |
| 要求書の AI 一次レビュー（読み取り専用。人のレビューの前に行う） | request-reviewer |
| 要件定義書（機能要件、インターフェース仕様、受け入れ条件） | requirements-engineer |
| 要件定義書の AI 一次レビュー（読み取り専用。人のレビューの前に行う） | requirements-reviewer |
| 設計書 | software-designer |
| TypeScript の実装 | ts-developer |
| テストの作成・実行 | test-engineer |
| 変更のレビュー（読み取り専用） | code-reviewer |

変更記録（2026-11-25）: 設計書の担当を ts-developer から新設の software-designer に移し、ts-developer は実装専用にした。人の明示決定は、依頼「設計は設計専用のエージェントにさせる」による。エージェント名 `software-designer`、依頼の種類（設計 / 設計の更新）、返却の「実装への引き継ぎ」、実装中に設計変更が必要なときは ts-developer が止めて software-designer に回す進め方は AI が決めた。同じ変更を `.claude/skills/implement-test/SKILL.md`、`.claude/rules/`（agents.md、coding.md、documents.md、time-safety.md）、各エージェント定義、`docs/README.md`、`docs/900_templates/003_design/README.md` に反映した。ハーネス `.claude/harness/guard-write.mjs` には、software-designer の書き込み範囲を `docs/003_designs/` に限り、ts-developer の `docs/` への書き込みを禁止する変更を入れた（人の明示決定: 依頼「ハーネスを AI が書き換えて」。適用状態: 適用中）。

小さな修正やバグ修正は、パイプラインを使わずに該当エージェントへ直接依頼してよい。

## ハーネス
- `.claude/harness/` のフックが、フェーズとエージェントごとに書き込めるファイルを制限し、「承認」の記録を行う。拒否されたら理由に従って進め方を変え、回避しない
- フェーズの移動は `node .claude/harness/pipeline.mjs <start|status|advance|back>` だけで行う
- `.claude/harness/`、`.claude/state/`、`.claude/settings*.json` は変更できない。ユーザーが `.claude/harness/unlock` を置いたときだけ解除される

## 共通ルール（`.claude/rules/`）
エージェントもメインのセッションも、作業の前に該当するルールを読む。

| ファイル | 内容 |
|---|---|
| `.claude/rules/documents.md` | 文書の共通ルール（表形式、ID の書式、根拠と決定主体の記録、フォーマット例） |
| `.claude/rules/agents.md` | エージェント・スキル定義の章立て（入力・出力を別章にする）、全エージェント共通の振る舞い、書き込み範囲 |
| `.claude/rules/time-safety.md` | 誤った時刻を返さないための原則と、担当ごとの確認観点 |
| `.claude/rules/coding.md` | 実行環境、npm スクリプト、設計とテストの決まり（技術的な決まり） |

仕様やプロジェクトルールを更新するときは、[根拠と決定主体の記録](.claude/rules/documents.md#41-根拠と決定主体)に従い、人が明示した範囲と AI が選んだ内容を記録する。

## フォーマット例（`docs/900_templates/`）

文書は 1 つのフォルダに、`README.md`（表題と目次）と章ごとのファイル `NNN_<章の見出し>.md` で置く。番号は作業の順（若い工程ほど小さい）。`<NNN>` は要求書のフォルダで決めた機能の番号で、現在の機能のパスは `pipeline.mjs status` が表示する。名前の決まりは `docs/README.md`。

| 文書 | フォーマット例 | 保存先 |
|---|---|---|
| 要求書 | `docs/900_templates/001_request/` | `docs/001_requests/<NNN>_<機能名>/` |
| 要件定義書 | `docs/900_templates/002_requirements/` | `docs/002_requirements/<NNN>_<機能名>/` |
| 設計書 | `docs/900_templates/003_design/` | `docs/003_designs/<NNN>_<機能名>/` |
| レビュー結果 | `docs/900_templates/004_review/` | `docs/004_reviews/<NNN>_<機能名>/` |

## ディレクトリ

| パス | 内容 |
|---|---|
| `src/` | 本番コード |
| `test/` | テスト |
| `docs/001_requests/<NNN>_<機能名>/` | 要求書 |
| `docs/002_requirements/<NNN>_<機能名>/` | 要件定義書 |
| `docs/003_designs/<NNN>_<機能名>/` | 設計書 |
| `docs/004_reviews/<NNN>_<機能名>/` | レビュー結果 |
| `docs/900_templates/` | フォーマット例 |
| `docs/910_knowledge/` | ノウハウ（要件定義の極意など。判断の参考にする資材） |
