# 開発ガイド

- [初期機能の設計](docs/design.md)
- [利用仕様案と前提条件](docs/usage.md)
- [調査・検証記録](VERIFICATION.md)

現在は設計段階。実装、依存関係の導入、発行は行っていない。

## 共通技術資料

[AppDockの作業ルール](../AppDock.at365/AGENTS.md)を入口とし、[Applet実装](../AppDock.at365/docs/applet-development.md)、[API](../AppDock.at365/docs/extensions.md)、[ローカルページ](../AppDock.at365/docs/applet-pages.md)、[MCP](../AppDock.at365/docs/automation.md)、[保存領域](../AppDock.at365/docs/settings-sync.md)に従う。

## 開発環境

実装はNode AppletとローカルHTML/TypeScript UIを予定する。実行時はAppDock同梱Nodeを使用し、Codex実行プログラムは同じPCに用意する。

Node・pnpm・ビルド依存の固定版とセットアップ手順は、実装時に共通の依存方針へ合わせて決める。グローバルツールの導入や既存Codexの更新を、この設計作業には含めない。

## ビルド・テスト・発行

現時点では実行可能なソース、manifest、ビルド・発行スクリプトはない。

実装開始時に設計書の受け入れ条件に対応する試験とビルド手順を用意する。発行先は共通手順に従う `A:/40.ARTIFACT/Applet.ChatCodex.at365` とし、今回の文書作成では発行しない。

## リポジトリの状態

独立したローカルGitリポジトリ。初期ブランチは `main`。リモートと追跡先は未設定で、初回コミットも作成していない。
