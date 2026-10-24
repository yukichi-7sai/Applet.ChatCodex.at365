# 調査・検証記録

## 2026-10-25 初期設計

### 対象と実施範囲

- `A:/30.PROJECT/Applet.ChatCodex.at365` を新規の独立Gitリポジトリとして初期化した。
- ブランチはmain、初回コミットなし、リモート・追跡先なし。取得先がないためpullは実施していない。
- 親30.PROJECTと参照元AppDock本体には既存変更があり、読み取りのみとした。自動pull・stash・既存変更の統合は行っていない。
- 既存のNode Applet、ローカルページ、pageActions、notifyChanged、Storage、共通API、MCPの契約と実装を参照した。
- OpenAI公式のApp Server・モデル候補・思考量・MCP資料を確認した。

### 環境確認

`codex --version` は「The system cannot find the path specified.」で失敗。

ツール実行環境ではWindowsのcodex.cmdを検出したが、そのshimに記載されたWinGet管理下のCodex実行ファイルはTest-PathでFalseだった。これは当該実行環境からの観測であり、PC全体の導入状態の断定には使わない。

同日、通常のLUNAターミナルで `codex` を入力するとOpenAI Codex v0.161.0が起動するとの利用者確認を受けた。この通常ターミナルでの起動と、ツール環境の失敗を分けて記録する。実行環境・権限・コマンド解決の相違は未切り分け。

修復、再インストール、認証変更、MCP登録変更は実施していない。

### 文書確認

- Markdown 6文書、ローカル参照29件の存在を確認し、欠落なし。
- コードフェンスの対応、READMEの2見出し、会話上の人物名の非混入を確認。
- 新規7ファイルへ `git -c core.autocrlf=false diff --no-index --check` を実行し、空白エラーなし。LF文書に対するCRLF変換警告を避ける指定は当該検査コマンドだけで、Git設定は変更していない。
- 設計内の接続操作、差分の分割取得、モデル／思考量の対応、結果不明時の非再送、子プロセスの回収範囲を見直した。
- Gitはmain・コミットなし・リモートなし。7ファイルは未追跡のままで、stageも行っていない。

### 未実施

製品コード、manifest、ビルド・発行スクリプトは未作成。依存導入、ビルド、GUI、ツールからのCodex正常起動・schema生成、モデル取得、認証、MCP操作、停止・異常終了の実動作は未検証。

コミット、リモート追加、push、発行、Release、実利用先への配置は行っていない。

## 2026-10-25 初期実装 0.1.0

### 変更とレビュー

- 設計書を先にmainの `33f81c0`（docs: CodexチャットAppletの初期設計を追加）へコミットしてから実装した。実装分は未コミット。リモート・追跡先は未設定。
- Node Applet、ローカルチャット画面、モデル・思考量の選択、質問・確認、停止、PC専用の選択保存を実装した。実行時の外部依存は追加していない。
- 本体ソース・設定・依存・生成物は変更せず、固定Node、ページ契約、GUI起動補助、既存packerを読み取り利用した。
- 発行前レビューで、会話世代と接続世代の分離、最終itemと途中表示の重複防止、確認回答の型検証、結果不明時の非再送、所有プロセスだけを終了すること、ログの秘密値境界を確認・修正した。
- 共通エラー通知は一般Applet向けAPIが公開されていないため接続していない。会話欄と既存ログで扱い、[不足と境界](docs/host-gaps.md)へ記録した。

### 環境と通信仕様

- 通常ユーザー環境で同じ `codex --version` を再実行し、`codex-cli 0.161.0` を確認した。制限付きツール環境の起動失敗は再現条件の差として扱い、再インストール・認証変更は行っていない。
- `codex app-server generate-json-schema` を実行し、0.161.0の要求・応答の型を照合した。生成物は `.artifacts/codex-schema-01610/`。
- 固定Node 24.22.1を使用。GUI試験に使った固定AppDock EXEは0.86.14、SHA256は `7a84233f99c4fa5f46bed7d0ca3b79b84aa4e1e99ac93e48c24d58829ea465a6`。

### 実行結果

| 試験 | 結果 |
| --- | --- |
| `dev.bat test` | 17/17成功、失敗・skipなし。疑似サーバーへの実stdio、会話継続・新規、選択保存、承認・質問、停止、長文分割、異常受信、切断、入力上限、探索を確認 |
| `dev.bat build` | 全JS/CJSの構文検査と配布用組立成功 |
| `dev.bat ui` | 固定EXE＋隔離profile＋疑似Codexで5群成功。会話・選択・質問・承認・停止・新規会話・配色・狭い表示幅・page/window移動・子終了・選択だけの復元を確認 |
| `dev.bat probe` | 実Codexで初期化・認証済み状態・7モデル・返答を確認。既存MCPのappdock_get_infoがcompleted。設定変更・コマンド実行は行わない試験 |
| `scripts/real-ui-test.cjs` | 固定EXE内で未改変のAppletコードと実Codex 0.161.0を使い、7モデルの取得・思考量選択・実返答の表示成功 |
| `scripts/lifecycle-probe.cjs` | 親Nodeを後処理せず終了し、実App ServerのPIDがpipe切断後に消滅することを確認 |

GUI試験の初回は、試験設定へshortcutsの誤った配列値を追加したため本体画面の生成待ちで失敗した。試験設定だけを修正し、その隔離プロセスを終了して再実行し成功した。本体修正や設定検証の緩和は行っていない。

成功記録:

- `.artifacts/ui-1792865795051/result.json`、dark.png、narrow.png。画像も確認した。
- `.artifacts/real-probe-1792865668843/result.json`。本文・認証・ツール引数は保存していない。
- `.artifacts/real-ui-1792865936887/result.json`。実Codex実体を専用binへ同一hashでコピーしてPATHへ渡し、GUI試験のLOCALAPPDATA隔離と実体探索を両立した。認証はコピーしていない。
- `.artifacts/lifecycle-1792865936636/result.json`。

### 発行物

- `publish.bat` 成功。発行先は `A:/40.ARTIFACT/Applet.ChatCodex.at365`。
- Appletフォルダー、update.json、update.zip、初回の配置用スクリプトを作成。既存のAppDock.Updater.exeを直接利用し、本体を再ビルドしていない。
- ZIPは19,391 bytes、SHA256 `0e391840d32c9710331dee38d0444e763df19cbae88c1444474267c459755ef5`。feedの版・ID・サイズ・hashと一致し、ZIP内8ファイルすべてが発行フォルダーのhashと一致した。
- manifestと実行コード7ファイルは実GUI試験時のコピーとも一致する。配布用USAGE.mdのソースリポジトリ専用リンクを単独読書用の表記へ整えて同版で再梱包した。実行コードの変更を伴わない文書のみの修正。
- 証跡は `.artifacts/publish-verification.json`。試験プロセスの残存なしを確認した。

### 未確認・対象外

- 実Codexで設定を書き換える試験、実環境での実行承認・質問の操作は未実施。これらのUIと要求応答は疑似サーバーで確認した。
- 物理IME・実キーボード操作、すべてのCodex導入方式・将来版、全種類のサーバー要求、全子孫プロセスの異常終了回収は保証していない。
- 実利用先への配置、実装分のコミット・push・GitHub Releaseは行っていない。

## 2026-10-25 実装のコミット確認

### 対象と追加文書

- mainの初期設計コミット以降に作成したApplet実装・画面・試験・ビルド／発行／配置スクリプトと関連文書を対象とする。リモート・追跡先がないためpullは行わない。実効author/committerは `yukichi-7sai <yukichi@at365.jp>`。
- ChatGPTアプリだけの端末にはcodexコマンドがなかったとの利用者確認を受け、Codex CLIの別途導入を利用条件に明記した。同じユーザー・同じホストのconfig.toml/MCP共有と、CODEX_HOME等による相違も公式資料に基づき追記した。
- この依頼で製品コードは変更していない。manifest・実行コード7ファイルは、初期実装時の実GUIコピーと発行済み0.1.0にSHA256で一致した。文書のみの追加のため版更新・再発行は行わず、発行先USAGE.mdは前回発行時の文面を保持する。

### 必要回帰と結果

実装時の成功記録を照合したが、試験スクリプト等を含む入力hashと単体試験の完全ログが不足していたため、当該Appletの単体・GUI・実Codex画面・プロセス終了を再実行した。本体・共通API・依存は変更しておらず、兄弟Appletや本体全体の回帰は対象に含めない。

証跡は `.artifacts/commit-validation-20261025/`。実行前後のApplet入力22ファイル、共有入力4ファイルのSHA256一致を確認した。固定Node 24.22.1、Codex CLI 0.161.0、通常Windowsユーザー環境で実行した。

| 試験 | 今回の結果と記録 |
| --- | --- |
| `dev.bat test` | 17/17成功、失敗・skipなし。test.log / test-result.json |
| `dev.bat build` | 全JS/CJS構文確認と組立成功。build.log / build-result.json |
| `dev.bat ui` | 隔離GUI5群成功。ui.log / ui-result.json、`.artifacts/ui-1792866716053/result.json`。配色・狭幅の画像も確認 |
| `scripts/real-ui-test.cjs` | 実Codexから7モデルを取得し、返答を画面へ表示。real-ui.log / real-ui-result.json、`.artifacts/real-ui-1792866731395/result.json` |
| `scripts/lifecycle-probe.cjs` | 親終了後に所有App Serverが終了。lifecycle.log / lifecycle-result.json、`.artifacts/lifecycle-1792866753636/result.json` |
| 文書・成果物照合 | Markdown 7文書・ローカル参照39件、README見出し・フェンス・空白、発行済みruntimeとの一致を確認。inputs-after.json / artifact-check.json |

今回の固定GUI EXEは、別作業で既に発行されていたAppDock 0.87.0（SHA256 `85e9d22ed376f7b944215cb1330b557118f7412fe855b282ebc5a357a35668d8`）。検証前・GUI2試験・検証後で同一hashを確認した。本体を変更・再ビルドしていない。

発行済みAppletのupdate.zipは引き続き19,391 bytes、SHA256 `0e391840d32c9710331dee38d0444e763df19cbae88c1444474267c459755ef5` でfeedに一致する。実CodexでのMCP情報取得は初期実装時の記録であり、今回の再実行項目には含めない。設定変更・実利用先deploy等の未確認範囲は前節のままとする。

最終stage tree・作業ファイルとの一致・コミット後のSHA/treeは、同証跡ディレクトリのstage.jsonとcommit.jsonへ記録する。push・リモート作成・Releaseは行わない。
