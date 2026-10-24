# 開発ガイド

- [初期機能の設計](docs/design.md)
- [利用仕様案と前提条件](docs/usage.md)
- [調査・検証記録](VERIFICATION.md)
- [本体側の不足と境界](docs/host-gaps.md)

初期実装はチャットとモデル・思考量の選択に限定する。設計の初回コミットと実装・検証の記録はVERIFICATIONへ分けて記載する。

## 共通技術資料

[AppDockの作業ルール](../AppDock.at365/AGENTS.md)を入口とし、[Applet実装](../AppDock.at365/docs/applet-development.md)、[API](../AppDock.at365/docs/extensions.md)、[ローカルページ](../AppDock.at365/docs/applet-pages.md)、[MCP](../AppDock.at365/docs/automation.md)、[保存領域](../AppDock.at365/docs/settings-sync.md)に従う。

## 開発環境

Node Applet（CommonJS JavaScript）とローカルHTML/JavaScript UI。実行時はAppDock同梱Nodeを使用し、Codex実行プログラムは同じPCに用意する。

ビルド・単体試験は隣のAppDockのtoolchain.jsonが固定するNodeをdev.bat経由で使う。外部の実行時依存、TypeScriptコンパイラー、トランスパイル工程は追加していない。GUI試験だけは本体の固定Playwrightと既存の起動補助を読み取り利用し、本体のビルド・依存導入・変更はしない。

## ビルド・テスト・発行

| コマンド | 内容 |
| --- | --- |
| `dev.bat test` | Node標準テスト、疑似App Serverとの実stdio |
| `dev.bat build` | 構文検査、out/Applet.ChatCodex.at365への組立 |
| `dev.bat ui` | 固定AppDock EXE＋隔離設定＋疑似CodexのGUI試験 |
| `dev.bat probe` | 実Codexの会話と既存MCP情報取得。設定変更は行わない |
| `publish.bat` | 本Appletだけ発行し、個別update.zip/update.jsonを生成 |

発行には本体の既存AppDock.Updater.exeを使う。通常の共通梱包スクリプトは本体側を再ビルドするため、本体変更禁止のこの作業では既存の同じpackerを直接呼び出す。既存packerがない場合は失敗させ、黙って本体を生成しない。

実Codex GUI試験は固定Nodeで `scripts/real-ui-test.cjs`、親プロセス異常終了の確認は `scripts/lifecycle-probe.cjs` を実行する。実Codex試験はサインイン済み環境とモデル利用を伴うので、通常の単体試験には含めない。本文・認証を検証ログへ記録しない。

発行先は `A:/40.ARTIFACT/Applet.ChatCodex.at365`。deploy.batは配置先AppDockフォルダーを引数に取り、発行済みのAppletだけをコピーする。配布・実利用先への配置・外部公開はそれぞれ依頼範囲に従う。
