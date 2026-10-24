# ChatCodexの利用

Applet 0.1.0。操作と内部構造の詳細は[設計書](design.md)を参照する。

## できること

AppDock内の1つのチャット画面でCodexと会話し、モデルと思考量を選択する。Codexは既存のMCP接続を通じて、公開されているAppDockの設定取得・変更やコマンドを利用する。

チャットの送信、途中表示、停止、新しい会話、Codexから届く確認への返答を扱う。履歴一覧、添付ファイル、ローカルAIサーバーへの直接接続は初期範囲に含めない。

## 前提条件

- AppDock 0.86.13以上。実測対象は[検証記録](../VERIFICATION.md)を参照。
- 同じWindows PCでCodex CLIのapp-serverを起動でき、利用する認証が済んでいること。確認したCodex版は0.161.0。
- そのCodexが読む設定へ対象AppDockのMCPが登録され、必要な操作が許可されていること。

Codex CLIを別途インストールし、通常のターミナルで `codex --version` と `codex app-server --help` が成功する環境を用意する。ChatGPTアプリだけの導入は、このAppletの利用条件を満たさない。ChatGPTのデスクトップ画面を起動しておく必要はない。

実体のcodex.exe、WinGet型の単純なcmd shim、標準のnpm vendor配置を探索する。任意の独自shimは実行しない。自動導入・更新はしない。

## Codex設定の共有

同じOSユーザー・同じCodexホストでは、ChatGPTアプリとCodex CLIは既定の `~/.codex/config.toml`（Windowsでは通常 `%USERPROFILE%\.codex\config.toml`）とMCP設定を共有する。CLIの実行プログラムの導入と、設定の保存先は別のもの。[公式MCP資料](https://learn.chatgpt.com/docs/extend/mcp)を参照。

`CODEX_HOME` が異なる環境や別ユーザー、別ホストでは同じ保存先にならない。信頼済みプロジェクトの `.codex/config.toml`、選択したプロファイル、起動時の指定によっても有効な設定が変わる。[設定の優先順位](https://learn.chatgpt.com/docs/config-file/config-basic)と[環境変数](https://learn.chatgpt.com/docs/config-file/environment-variables)を参照。

このAppletは既存の環境変数を引き継ぎ、独自の `CODEX_HOME` を設定せず、Codex設定を書き換えない。既存MCPを同じ設定から利用し、モデル・思考量はこのAppletの会話へ指定する。ChatGPTアプリで開いている会話への接続は行わない。

## 画面と保存

操作欄はモデル、思考量、会話欄、入力欄、送信／停止、新しいチャットに絞る。Codexからの質問・確認は会話欄に表示する。

モデル・思考量の選択だけをAppletのPC専用Storageへ保存する。会話はAppletの実行中だけ保持し、ページを隠しても継続する。Applet再起動後は新しい会話から始める。Codex自身が保存する履歴はCodex側の設定に従い、このAppletから一覧表示・削除しない。

## 操作

ページを初めて開くとCodexへ接続する。モデルと思考量を選び、文章を入力して送信する。Enterで送信、Shift+Enterで改行。IMEの変換確定では送信しない。

生成中は送信ボタンが「停止」に変わる。Codexから質問・実行確認が届いた場合は会話内で答える。「新しいチャット」は待機中に会話を切り替える。送信済みの設定操作を停止で巻き戻すことはできない。

## 接続できない場合と制約

Codexの起動、認証、MCPの登録・許可は既存のCodexと本体の設定で整える。Appletは独自のインストーラー、ログイン画面、MCP登録画面を持たない。

通信が切れて送信結果が不明な場合は、自動で再送しない。現在の会話を中断状態として表示し、再接続後は新しい会話を開始する。

Codex App ServerはExperimental。未対応の確認形式は自動承認せず、理由を会話内に表示する。現行本体に公開されていない共通エラー通知への接続は行わず、Appletの非同期エラーは会話内と本体ログで確認する。[本体側の不足](host-gaps.md)を参照。
