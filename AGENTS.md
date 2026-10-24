# ChatCodex Appletの作業ルール

## 共通資料

- [30.PROJECTの共通ルール](../AGENTS.md)
- [AppDockの作業ルール](../AppDock.at365/AGENTS.md)
- [Applet実装ガイド](../AppDock.at365/docs/applet-development.md)
- [Applet API](../AppDock.at365/docs/extensions.md)
- [Appletページ](../AppDock.at365/docs/applet-pages.md)
- [MCPと共通操作API](../AppDock.at365/docs/automation.md)
- [設定と保存領域](../AppDock.at365/docs/settings-sync.md)
- [ドキュメント方針](../AppDock.at365/docs/documentation.md)

## このリポジトリ

- 機能の範囲と実装方針は[設計書](docs/design.md)を正本とする。[本体側の不足と境界](docs/host-gaps.md)も確認する。
- 機能はチャット、モデル・思考量・4つの承認モード、送信キー・表示／開始時の指示・メモリ利用の設定に限定する。履歴管理、接続先管理、独自の権限ルール編集は追加しない。
- 詳細／通信表示は認証系RPC本文と秘密値を除外してメモリー内だけへ保持する。Codex内部の最終指示・自動注入メモリ本文を取得できたと装わない。開始時の操作指示とメモリ利用指定は新しい会話だけへ適用し、Codex設定ファイルやメモリファイルを変更しない。
- 詳細表示と開発者向け通信ログは設定・保持枠・回収位置を分ける。上限では古いカード全体を回収して記録を続け、画面側の古いカードも除く。診断の回収で会話・下書き・承認要求を破棄しない。
- 承認モードは会話単位のCodex API指定で扱い、config.tomlを書き換えない。継承モードへ戻すときは会話開始時の有効な設定を復元し、制限による拒否を自動緩和・再送しない。
- Codex固有の通信と互換性対応はApplet内へ閉じ込める。本体は変更しない。本体の変更が必要になった場合もApplet側の実装を先に進め、既存APIで解決できない根拠・影響・必要な変更を記録する。
- 本体の設定変更にはCodexから既存MCPを使う。Appletから設定ファイルを直接編集しない。
- 共通仕様は本体文書へリンクし、このリポジトリにはApplet固有の仕様と判断を記載する。
- READMEは導入・ビルドだけ、開発文書の入口はDEVELOPMENT、実測結果はVERIFICATIONへ記載する。
