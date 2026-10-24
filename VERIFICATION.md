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

## 2026-10-25 承認モードと入力欄の一体化 0.2.0

### 変更範囲と発行前レビュー

- mainの `81b2063`、clean・リモート／追跡先なしを確認して着手した。取得先がないためpullは行っていない。今回の実装は未コミット。
- 「Codexの設定に従う」「確認して実行」「自動審査」「フルアクセス」を追加した。入力欄の同じ枠内に承認モード・モデル・思考量・送信／停止を配置し、説明付きメニュー、キーボード操作、狭幅時の2段配置を実装した。
- 選択をPC専用preferencesへ保存する設定追加のため、共通手順に従いマイナー版を0.2.0へ更新した。旧保存値は読取り時にinheritとして扱い、自動で保存・移行しない。
- Codex 0.161.0の生成schemaと公式資料を照合した。thread/startの有効設定を保持し、各turn/startで選択した固定プリセットを指定する。継承へ戻す場合は開始時の完全な承認・sandbox設定を復元する。
- 発行前レビューで、保存失敗・未知値・実行中／古い世代の選択拒否、送信開始時のモード固定、継承値の復元、管理制限による拒否時の非再送・非緩和、グローバルconfigの非変更を確認した。任意のポリシーJSONやRPCを画面から受け付ける入口は追加していない。
- 入力項目のないMCPフォームを自動キャンセルしていた箇所を、明示的な許可・拒否・キャンセルのカードへ変更した。未対応フォーム／URL形式はキャンセル理由を会話へ残す。
- 本体ソース・設定・依存は変更していない。固定Node、GUI起動補助、既存packerを読み取り利用した。AppDock/MCPの独自の操作許可や管理制限は維持する。

### 検証

通常Windowsユーザー環境、固定Node 24.22.1、Codex CLI 0.161.0で確認した。最終発行物のGUIに使った固定AppDock EXEは0.87.1、SHA256 `904e28cc5f73080963db1596583e5a99e1ad1d43d2b352b0bf913e8d41fcc7c2`。本体は別作業で発行済みのものを使い、再ビルドしていない。

| 試験 | 結果 |
| --- | --- |
| `dev.bat test` | 22/22成功、失敗・skipなし。4モードの要求値と継承復元、保存互換・保存失敗・不正値・実行中拒否、Codex側拒否時の非再送、空MCPフォームの3回答を追加確認 |
| `publish.bat` | 全実行JS/CJSの構文確認、0.2.0組立、個別ZIP/feedの発行成功 |
| 発行物に対する `dev.bat ui` | GUI6群成功。メニュー4択、選択・下書き保持、キーボード・外側クリック・停止・質問／承認、再起動後の選択復元を確認 |
| 狭幅・配色 | 明暗の画像を確認。Playwrightで360 CSS pxを明示して長いモデル名の収まりとメニューの画面内配置を検査。実デバイスの表示幅とは区別する |
| 発行物に対する `dev.bat approval` | 実App Serverから実MCP確認要求を受信し、画面で許可して続行。4モードでの送信受理とモデル返答、フルアクセス後にon-request/user/readOnlyへ戻す指定を確認 |

単体試験の完全ログ・入力hashは `.artifacts/approval-020/test.log`、test-result.json、inputs-before.json、unit-reuse.json。以降に変更したGUI試験スクリプトと文書は単体試験の入力ではなく、src・tests・runner・manifest/packageのhashが一致するため、その成功結果を再利用した。

発行と最終GUIの実行前後入力・共通入力・ログのhash、終了コード:

- `.artifacts/approval-020/publish-1792869249379/`
- `.artifacts/approval-020/ui-1792869343893/`
- `.artifacts/approval-020/approval-1792869361366/`

いずれも終了コード0、入力hash一致。最終GUIは `CHATCODEX_TEST_PACKAGE` で発行済みフォルダーを指定したコピーを使用した。

画面・詳細結果:

- `.artifacts/ui-1792869344779/result.json`、light-menu.png、dark-menu.png、narrow.png。
- `.artifacts/approval-ui-1792869362184/result.json`、policies.jsonl、events.jsonl、real-mcp-approval.png。

実承認試験では、Codex子プロセスの起動引数だけでon-request/user/read-onlyを指定した。確認用MCPは同意結果を返すだけで設定・ファイルを変更しない。診断entryからネイティブのmcpServer/tool/callを呼び、実際のMCP elicitationをAppletへ渡して画面で回答した後、各モードでモデルへ文章を送信した。モデルによる実AppDock設定変更や、自動審査の判断内容そのものを確認した試験ではない。

### 試験中に解消した問題

- メニューのtoggle完了前にフォーカス／配置を検査して失敗したため、試験側で完了を待つようにした。製品の確認処理や検査条件を緩めていない。初回GUIログと最終の成功ログを区別している。
- 実Codexの初期試験は、単一EXEをコピーした隔離環境でモデルによるツール呼出が「ツール実行基盤のファイルが見つからない」となり、承認前で失敗した。Codexの元の実体・導入場所を利用し、GUIだけが隔離したLOCALAPPDATAはCodex子プロセスへ通常値を渡す構成にした。MCP確認要求の検査は上記の診断RPCで独立して行う方式へ整えた。ユーザーのCodex設定・認証・インストールは変更していない。初期試験の失敗を実AppDock設定変更の失敗原因と同一視しない。

### 発行物と未確認範囲

- 発行先: `A:/40.ARTIFACT/Applet.ChatCodex.at365`。版0.2.0、最低ホスト版0.86.13。
- update.zipは24,789 bytes、SHA256 `70bf7a7c62368d8ecdacf0d0a967936b6059412e6d7f441a2c19cd2d0d194030`。feedの版・サイズ・hashと一致。ZIP内9ファイルすべてが発行フォルダーと一致し、実行コード／manifest 8ファイルはソースとも一致した。
- 梱包照合は `.artifacts/approval-020/publish-verification.json`。既存配置スクリプトを保持し、実利用先へのdeployは行っていない。
- KAGUYA実機、そこで有効な管理・承認設定との組合せ、実AppDock設定の保存、URL型／複雑なMCPフォーム、自動審査の全判断結果は未確認。LUNAの成功だけでKAGUYAでの旧キャンセル原因が解消したと断定しない。
- 今回の実装のcommit・push・Releaseは行っていない。
- 最終文書検査は33ファイル、JS/CJS構文15件、ローカル参照39件で成功。PowerShellのUTF-8 BOM/CRLF、BATのASCII（CP932互換）/CRLFも確認した。終了済みの今回の0.2.0隔離profileは種類ごとに直近3回を残し、古い4件の結果を退避して整理した。0.1.0の再利用証跡は保持し、試験プロセスの残存なしを確認した。記録は `.artifacts/approval-020/document-check.json`、cleanup.json。

## 2026-10-25 0.2.0の利用者確認とコミット照合

### 実利用環境での確認報告

- 利用者から、承認要求が表示され、許可すると実際にAppDockのテーマが変わったとの確認を受けた。代理承認（自動審査）も正常に動作したとの報告を受けた。
- 提示されたチャットログでは、テーマをダーク、ライト、システムへ順に変更し、それぞれ保存確認を返している。これは利用者の実機確認として記録し、作業者が同じ操作を再実行した結果とは区別する。
- 先行会話で試験端末はKAGUYAと説明されている。今回、端末の有効なCodex設定値を直接収集・比較する操作はしていない。旧版のキャンセル原因の特定や、すべての確認形式への対応を意味するものではない。

### コミット対象と検証の再利用

- mainの `81b2063` 以降の0.2.0実装、選択UI、単体／GUI／実承認試験、関連文書を対象とする。リモート・追跡先なし、既存の未コミット実装を保持したためpullは行っていない。
- 必要回帰は単体22件、ビルド・発行、発行物GUI6群、実App ServerのMCP承認回答と4モード受理・継承復元。実装時の成功ログ・終了コード・入力hash・固定EXE・試験配置コピーを照合し、同じ対象であることを確認して再利用した。
- 発行時から変わった入力はGUI試験のメニュー配置待ちだけで、ビルド／梱包が実行・収録する入力ではない。現行GUI試験スクリプトは、発行後の最終GUI・実承認試験の記録と一致した。本体の共有入力も一致した。
- 発行済み0.2.0のZIPとfeed、9ファイルのhashを再照合し、manifest／実行コード8ファイルがソースと一致した。今回追加した内容はこの検証記録だけで、製品修正・版更新・再発行は行っていない。
- 再利用の照合結果は `.artifacts/commit-validation-020-20261025/reuse.json`。最終文書・リンク・差分検査を行い、stageと作業ファイルの一致、最終stage tree、コミット後SHA/treeは同ディレクトリのstage.jsonとcommit.jsonへ記録する。
- 実効author/committerは `yukichi-7sai <yukichi@at365.jp>`。本体変更、実利用先へのdeploy、リモート作成、push、Releaseは行わない。
