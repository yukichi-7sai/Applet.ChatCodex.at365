# 開発ガイド

- [初期機能の設計](docs/design.md)
- [将来構想: Applet開発と作業再開（未実装）](docs/design.md#future-applet-development)
- [利用仕様案と前提条件](docs/usage.md)
- [調査・検証記録](VERIFICATION.md)
- [本体側の不足と境界](docs/host-gaps.md)

実装はチャットと最後の会話の復元、利用制限の停止表示と手動再開、モデル・思考量・4つの承認モード、送信キー・表示・開始時の指示とメモリ利用の設定に限定する。設計の初回コミットと実装・検証の記録はVERIFICATIONへ分けて記載する。

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
| `dev.bat approval` | 実Codexを子プロセス限定の厳しい設定で起動し、無変更の確認用MCP・承認カード・4モード・継承値の復元を隔離GUIで確認 |
| `publish.bat` | 本Appletだけ発行し、個別update.zip/update.jsonを生成 |

発行には本体の既存AppDock.Updater.exeを使う。通常の共通梱包スクリプトは本体側を再ビルドするため、本体変更禁止のこの作業では既存の同じpackerを直接呼び出す。既存packerがない場合は失敗させ、黙って本体を生成しない。

実Codex GUI試験は固定Nodeで `scripts/real-ui-test.cjs`、親プロセス異常終了の確認は `scripts/lifecycle-probe.cjs` を実行する。実Codex試験はサインイン済み環境とモデル利用を伴うので、通常の単体試験には含めない。本文・認証を検証ログへ記録しない。

実Codexで会話を開始する試験はthread/startへ `ephemeral: true` を指定し、応答のthread.ephemeralと保存パス未設定を確認する。GUI試験は隔離コピーのentryだけで指定を追加し、通常版の起動時送信や会話保存設定を変更しない。`dev.bat approval` は終了後に別App Serverから試験用cwdの保存履歴を照会し、0件であることも確認する。過去の試験で残った履歴は自動削除しない。

再開の永続化試験は例外として、固定Nodeで `scripts/resume-probe.cjs` を実行する。認証のない隔離CODEX_HOME、file認証ストア、loopbackのResponses模擬サーバーを使い、実Codexの保存・終了・再開・次の入力に以前の文脈が含まれることを確認する。通常の認証や履歴・外部モデルは使わない。再開参照の保存失敗・消失・未知形式・別保存先・承認待ち中断・元の継承権限は単体試験で確認する。`dev.bat ui` は固定EXEを終了・再起動し、実Storageから会話を復元して次の入力を送るところまで確認する。

固定Nodeで `scripts/startup-probe.cjs` を実行すると、実App Serverのthread/startでメモリ指定の継承／true／falseと不正値拒否を確認する。モデルへの送信は行わず、Codex設定ファイルの前後hash一致を記録する。自動注入されたメモリ本文は収集しない。メモリ機能そのものはCodex設定に従う。

固定Nodeで `scripts/resume-probe.cjs --usage` を実行すると、同じ認証なし隔離CODEX_HOMEとローカル模擬モデルを使い、HTTP 429による失敗・停止情報の保存・プロセス終了後の復元・手動再開を確認する。利用状況APIだけは模擬応答で回復を切り替え、実Codexが返す制限エラーと継続時の文脈を確認する。通常の利用枠を消費して制限を起こす試験は行わない。GUIは利用制限・時刻不明・確認失敗・下書き保持・停止状態での本体再起動・手動再開を確認する。

`dev.bat ui` は送信キーの既定Ctrl+Enter・即時Enter切替・改行・IMEイベントの抑止、詳細／通信の独立設定と折りたたみ、大量ログ後の古いDOM回収・会話保持・記録継続、秘密値の伏せ字とHTML非実行、開始時設定の変更通知も確認する。単体試験では件数・UTF-8バイト上限の両方と、通常会話とは別の保持枠・差分の回収位置を確認する。IME試験は合成イベントであり、物理キーボードでの日本語変換操作とは区別する。`dev.bat approval` は開始指示とメモリ指定の変更が新しい会話だけへ適用されることも実App Serverで確認する。

`dev.bat approval` はCodexの起動引数だけでon-request/user/read-onlyと確認用MCPを指定し、ユーザーのconfig.tomlは変更しない。診断用entryで元のApplet処理を包み、実行時の承認設定だけを証跡へ残す。確認用MCPは承認回答を返すだけで、AppDock設定・ファイル・外部状態を変更しない。ネイティブのmcpServer/tool/callで実MCP確認要求を発生させ、カードで許可した後にモデルへの送信を続ける。全モードの返答と、フルアクセスから継承へ戻した際のread-only復元を確認する。これはKAGUYA実機や実AppDock設定変更の確認とは区別する。

`dev.bat ui` と `dev.bat approval` は、任意の `CHATCODEX_TEST_PACKAGE` に発行済みAppletフォルダーを指定すると、そのコピーを隔離profileで検証する。通常はoutを使う。実Codexは元の導入場所の実体を起動し、隣接するツール実行基盤を失わないようにする。隔離GUIのLOCALAPPDATA変更はCodex子プロセスだけ通常値へ戻す。認証ファイルはコピーしない。

発行先は `A:/40.ARTIFACT/Applet.ChatCodex.at365`。deploy.batは配置先AppDockフォルダーを引数に取り、発行済みのAppletだけをコピーする。配布・実利用先への配置・外部公開はそれぞれ依頼範囲に従う。
