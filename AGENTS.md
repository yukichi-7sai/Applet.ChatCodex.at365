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

- 現在は設計段階。機能の範囲と実装方針は[設計書](docs/design.md)を正本とする。
- 初期機能はチャットとモデル・思考量の選択に限定する。履歴管理、接続先管理、独自の権限設定を先に追加しない。
- Codex固有の通信と互換性対応はApplet内へ閉じ込める。本体は変更しない。本体の変更が必要になった場合もApplet側の実装を先に進め、既存APIで解決できない根拠・影響・必要な変更を記録する。
- 本体の設定変更にはCodexから既存MCPを使う。Appletから設定ファイルを直接編集しない。
- 共通仕様は本体文書へリンクし、このリポジトリにはApplet固有の仕様と判断を記載する。
- READMEは導入・ビルドだけ、開発文書の入口はDEVELOPMENT、実測結果はVERIFICATIONへ記載する。
