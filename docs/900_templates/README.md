# フォーマット例

文書ごとのフォーマット例。フォルダをファイルごと複製して使う。名前の決まりは [../README.md](../README.md)、書き方は `.claude/rules/documents.md`。

| フォルダ | 文書 | 複製先 |
|---|---|---|
| `001_request/` | 要求書 | `docs/001_requests/<NNN>_<機能名>/` |
| `002_requirements/` | 要件定義書 | `docs/002_requirements/<NNN>_<機能名>/` |
| `003_design/` | 設計書 | `docs/003_designs/<NNN>_<機能名>/` |
| `004_review/` | レビュー結果 | `docs/004_reviews/<NNN>_<機能名>/` |

- 各フォルダの `README.md` は、文書の表題と章の目次のフォーマット例を兼ねる。冒頭の HTML コメントに使い方を書いてある（複製後は消す）
- 章ファイルの名前・番号・順番は変えない。該当がない章もファイルを残し「なし」と書く
