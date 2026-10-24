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

## 2026-10-25 0.3.0 表示・開始時設定・送信キー

### 範囲と発行前レビュー

- 0.2.0から設定4項目を追加するため、共通の版更新規則に従い0.3.0とした。通常／詳細／通信ログ、AppDock操作指示の送信、既存メモリの自動注入指定、Enter／Ctrl+Enter送信をAppletだけへ追加する。本体ソース・既存のユーザー設定・Codex設定ファイルは変更しない。
- 開始前はmainの01235be、clean、remote／upstreamなしを確認して着手した。継続作業中の再確認ではorigin/mainとGitHub／AQUAのremoteが存在したが、自分の変更を保持し、pull・統合・remote操作を行っていない。
- 発行前に差分と影響先をレビューした。共通Settingsによる保存・通知、PC専用preferencesとの分離、既定値、開始時設定の固定と次会話への反映、RPC要求IDの対応付け、秘密値・認証本文・思考本文の除外、表示量の上限、HTML非実行、既存の承認・モデル選択・停止・寿命を確認した。
- レビューで、詳細カードを通常表示へ隠した際の空画面案内を可視カード数に合わせて修正した。送信キーはCtrl+Enterを新しい既定値とし、Enter／Shift+Enterの改行、IMEのisComposing・compositionイベント・keyCode 229を考慮した。必要な単体再試験とビルドを行い、発行物のGUIを再確認する。発行を妨げる未解決の指摘はない。
- APIの範囲は公式App Server／Memories／設定参照とCodex 0.161.0生成schemaで照合した。メモリはthread/startのconfig内の `memories.use_memories` だけを指定する。features.memoriesやメモリ生成を強制変更せず、内部の最終指示・MEMORY_SUMMARY全文を取得できるとは説明しない。

### 検証結果

- 最終単体29/29、fail／skip 0、ビルド成功。証跡 `.artifacts/details-030/test-1792871858484/`。before／afterの入力hash一致。
- 発行前GUI8群成功。Ctrl+Enter既定・改行・Enterへの即時切替・IME合成イベント抑止・再起動後の設定保持、詳細／通信の切替と折りたたみ、ツール結果の秘密値伏せ字とscript文字列の非実行、開始時設定変更の案内、既存質問／承認／停止／表示先変更／360 CSS pxを確認。証跡 `.artifacts/details-030/ui-1792871815143/`、画面と結果 `.artifacts/ui-1792871816026/`。これは最後の空画面案内修正前の結果で、最終発行物でも同じGUIを確認する。
- 実Codex GUI成功。子プロセス限定のon-request／user／read-only設定、診断用MCPからの実承認要求への回答、4モードの送受信、継承read-only復元を確認。操作指示オフ・メモリfalseから、設定を変えて新しい会話を開始した際の操作指示オン・メモリtrueも確認。証跡 `.artifacts/details-030/approval-1792871870153/`、詳細 `.artifacts/approval-ui-1792871871001/`。before／after入力hash一致。
- 実App Serverの開始時プローブは継承／true／falseを受理し、不正な文字列を拒否した。Codex設定ファイルの前後hash一致。証跡 `.artifacts/details-030/startup-1792871403975/`、結果 `.artifacts/startup-probe-1792871404399/result.json`。このプローブ対象の通信コードは最終ソースと同一で、モデルへの送信やメモリ本文の収集は行っていない。
- 固定ホストAppDock 0.87.2、EXE SHA256 `aacda9fbd0086fd0ff7b47303b9c1e7a91b80dde68064d88659ccf5ccc384d4b`。実Codex CLI 0.161.0、EXE SHA256 `a0f89acca07a511734cac7fddee26b2106fab68918717bc90df16104a0760a30`。LUNAの隔離GUIであり、KAGUYA実機や実AppDockテーマ変更の再試験とは区別する。

### 最終発行物の確認

- 発行先 `A:/40.ARTIFACT/Applet.ChatCodex.at365`。`publish.bat` 終了コード0、証跡 `.artifacts/details-030/publish-1792871934009/`、入力hash一致。
- update.zipは30,441 bytes、SHA256 `2cc25cb48af6f2cd33c1b4f5f58feeb61bb472e5b4ab9d154f299b6226198e49`。feedの版0.3.0・サイズ・hashと一致。ZIP内11ファイルは発行フォルダーと一致し、実行コード／manifestの10ファイルはソースとも一致した。USAGE.mdも利用仕様からの生成結果と一致。詳細 `.artifacts/details-030/publish-verification.json`。
- `CHATCODEX_TEST_PACKAGE` に発行済みフォルダーを指定し、隔離コピーで最終GUI8群と実Codex GUIを再実行して成功。証跡 `.artifacts/details-030/ui-1792871942249/`、`.artifacts/details-030/approval-1792871959870/`。両方とも終了コード0・入力hash一致。画面／結果は `.artifacts/ui-1792871943124/`、`.artifacts/approval-ui-1792871960681/`。
- 最終文書・文字コード・構文・ローカルリンクの検査は37ファイル、JS/CJS構文19件、参照39件で成功。PowerShellのUTF-8 BOM／CRLF、BATのASCII／CRLF、manifestと設定既定値の一致、Git差分の空白検査も成功。詳細 `.artifacts/details-030/document-check.json`。
- 今回の0.3.0のGUI／実承認profileは各3回、開始時プローブは2回で、直近3回の保持範囲内。旧版の再利用証跡は保護し、削除対象はなかった。終了状態と保護対象の確認は `.artifacts/details-030/cleanup.json`。

### 制約と未実施

- IME確認はブラウザーの合成イベントと実際のEnter／Ctrl+Enter入力。物理キーボードでの日本語変換操作は未確認。360 CSS pxはPlaywrightのviewport指定であり、物理ディスプレイ幅の変更ではない。
- メモリ指定がAPIで受理・反映されることを確認した。Codex側でメモリ機能が無効な場合の自動注入や、内部MEMORY_SUMMARY本文そのものの取得・表示は保証しない。自動注入の指定は、モデルによる任意のファイル読取りを禁止する設定ではない。
- 認証本文を除外し、既知の秘密値形式を伏せるが、任意のツール出力のすべての機微情報を判定する機能ではない。詳細／通信の保持は現在の実行中の会話だけで、Codex自身の履歴保存設定は変更しない。
- 本体変更、実利用先へのdeploy、commit・push・Releaseは行っていない。Appletの設定は既存の共通Settingsを利用するため、本体との通信APIの追加も不要だった。

## 2026-10-25 将来のApplet開発・作業再開の文書化

- [設計書の第13節](docs/design.md#future-applet-development)へ、開発セットのClone、開発用チャット、実装・試験・ビルド・インストール、AppDock再起動後の利用と作業再開を未実装の構想として記録した。現在の0.3.0の仕様とは分け、DEVELOPMENTから参照を追加した。
- 原因別の中断・続行、会話IDと作業場所のPC専用保存、完了済み／結果不明の確認、段階的な実装案、未決事項と将来の受け入れ条件を整理した。
- 既存の未コミット実装を保持し、pull・統合は行っていない。今回は文書だけを変更し、ローカルリンク・明示アンカー・Markdown構造・差分の空白を確認した。製品コード・設定・版・発行物は変更せず、ビルド・実機試験・再発行・commit・pushは行っていない。

## 2026-10-25 0.3.0のコミット・プッシュ照合

- 01235be以降の0.3.0実装、送信キー・表示・開始時設定、試験と関連文書、未実装の将来構想を対象とする。通信ログの開発者設定への分離・上限回収と、Applet開発・会話再開の追加実装は含まない。既存の未コミット変更を保持し、pull・統合・本体変更は行っていない。
- 必要な回帰は単体29件、ビルド・梱包、発行物GUI8群、実App ServerのMCP承認と4モード・継承復元・開始時設定切替、メモリ指定の開始時プローブ。実装時の完全なログ・終了コード・入力hashと現状を照合した。
- 単体とビルド・発行は、関係するソース・試験・固定ツール・packer入力が一致するため成功結果を再利用した。収集対象に含まれていた本体EXEだけが変わっていたが、この2工程では読み込まない。判定と照合差分は `.artifacts/commit-validation-030-20261025/reuse.json`、phase-comparison.jsonに記録した。
- 固定AppDock EXEが0.87.3へ更新されていたため、発行済み0.3.0を隔離コピーしたGUI8群と実Codex GUIを再実行し、成功した。新しい証跡は同ディレクトリの `ui-1792873738251/`、`approval-1792873756469/`。ともに終了コード0・前後入力hash・ログhash一致。配置コピーの実行コード／Web資産9ファイルも発行物と一致した。
- 開始時プローブも通常ユーザー環境で再実行し、継承／true／false受理、不正値拒否、Codex設定ファイルの前後hash一致を確認した。証跡は `startup-1792873770631/`。今回採用したCLIは0.161.0、SHA256 `a0f89acca07a511734cac7fddee26b2106fab68918717bc90df16104a0760a30`。本体0.87.3のEXE SHA256は `be891a3312e86830f66598288dc585704b1e71eace8a2e4793b72d4651bc4cf5`。
- feed／ZIP／全11ファイルと、ソースの実行コード・manifest 10ファイル、生成USAGEを再照合して一致した。0.3.0のサイズ・hashは発行時から変わっていない。後続変更は設計・開発・検証の文書だけなので、版更新・再発行はしていない。今回の梱包照合と最終文書・構文・リンク検査は同ディレクトリのpublish-verification.jsonとdocument-check.jsonに記録する。
- 試験プロセスの終了を確認し、古い成功profile `ui-1792871343647` と `approval-ui-1792871408333` の結果メタデータを退避して整理した。GUI・実承認・開始時プローブは各直近3回と、旧版・再利用証跡を保持した。詳細は同ディレクトリのcleanup.json。
- 実効author／committerは `yukichi-7sai <yukichi@at365.jp>`。プッシュ前のGitHub mainは01235be、AQUAはブランチ未作成だった。設定済みoriginの2つのpush URLを使用する。stageと作業ファイルの一致・対象tree・commit後SHA・両リモートmainの照合は、同ディレクトリのstage.json、commit.json、push.jsonへ記録する。Release・実利用先へのdeployは対象外とする。

## 2026-10-25 0.4.0 通信ログの分離と上限回収

### 範囲・版更新・発行前レビュー

- mainの8692cfa、clean、origin/main追跡を確認し、実装前の `git pull --ff-only` はAlready up to dateだった。設定項目wireLogEnabledの追加と表示選択肢の変更を含むため0.4.0とした。本体ソース・保存済みユーザー設定・Codex設定ファイルは変更していない。
- 「チャットの表示内容」は通常／詳細とし、開発者向け通信ログを独立した初期オフのboolean設定にした。旧displayMode:traceは保存し直さず詳細として読み、通信は新しい設定をオンにした場合だけ記録する。自動移行・設定の破棄はしない。
- 詳細と通信は各512KiB／400カードの枠で古いカード全体を回収し、最新の記録を続ける。通常の会話の8MiB枠から分離し、種別ごとの先頭orderをページへ返して古いMap／DOMも回収する。上限到達で会話世代・会話ID・承認要求・下書きをリセットせず、記録停止カードも追加しない。
- 発行前に要件、独立したオン／オフ、既定値・旧値の読取り、カード単位の回収、バイトと件数の境界、種別ごとの表示位置、通常会話と実行中メッセージの保持、秘密値の除外、ページ応答サイズをレビューした。発行を妨げる指摘はなかった。会話再開・開発セット等の将来機能は追加していない。

### 発行前の確認

- 単体32/32、fail／skip 0、ビルド成功。件数上限の独立回収、UTF-8バイト上限でのカード全体の回収、繰り返しの記録、通常会話の回収との分離、差分カーソル、同じ会話での送信継続、新しいチャットでの整理状態リセットを確認。証跡 `.artifacts/logs-040/test-1792874725048/`。
- 固定GUI9群成功。通信ログの既定オフ、通常／詳細と独立した切替、疑似MCPの230件×開始／完了を含む大量通知、両種別の400カード以下の保持、古いDOMの回収、通常の会話保持、上限後の質問・承認・停止・新しいチャットを確認。既存の送信キー・IME合成イベント・配色・360 CSS px・表示先変更・再起動も成功。証跡 `.artifacts/logs-040/ui-1792874739435/`、画面／結果 `.artifacts/ui-1792874740309/`。
- 実Codex GUIでMCP承認回答、4モード受理、継承read-only復元、開始時設定の新しい会話への反映に成功。証跡 `.artifacts/logs-040/approval-1792874876800/`、画面／結果 `.artifacts/approval-ui-1792874877675/`。診断MCPであり、実AppDock設定の変更試験とは区別する。
- 各工程は終了コード0・前後入力hash一致。単体・最初のGUIの後に変更した利用仕様はビルド時に梱包される説明文で、試験対象の実行コード・試験は変わっていない。発行物を指定した最終GUIを別途確認する。
- 固定ホストAppDock 0.87.4、EXE SHA256 `291d291cae6f9eba5e21db13ac151bf9527c11a63b91682b5ec8c1688a313b7f`。Codex CLI 0.161.0、SHA256 `a0f89acca07a511734cac7fddee26b2106fab68918717bc90df16104a0760a30`。

### 発行物・最終確認

- 発行先 `A:/40.ARTIFACT/Applet.ChatCodex.at365`、版0.4.0、最低ホスト版0.86.13。publish終了コード0、入力hash一致。証跡 `.artifacts/logs-040/publish-1792874979485/`。
- update.zipは31,405 bytes、SHA256 `93f4d46cdc208eb91c2ebbb9097c3c08a733bcd02e36628a3243a14bd89aa28e`。feedの版・サイズ・hashが一致し、ZIP全11ファイルと発行フォルダー、実行コード／manifest 10ファイルとソース、生成USAGEと利用仕様が一致。照合結果 `.artifacts/logs-040/publish-verification.json`。
- 発行済みフォルダーをCHATCODEX_TEST_PACKAGEへ指定したコピーで、GUI9群と実Codex GUIを再実行して成功した。証跡 `.artifacts/logs-040/ui-1792874998748/`、`approval-1792875017765/`。画面／結果は `.artifacts/ui-1792874999651/`、`.artifacts/approval-ui-1792875018657/`。いずれも終了コード0・前後入力hash・ログhash一致。
- 文書・文字コード・構文・リンク・設定既定値を37ファイル、JS/CJS構文19件、ローカル参照43件で確認し、Git差分の空白検査も成功。`.artifacts/logs-040/document-check.json` に記録した。READMEの役割は変更していない。
- 今回の0.4.0のGUI／実承認profileは各2件で保持範囲内。試験プロセスの残存なしを確認し、過去版の再利用証跡は保護した。削除対象なし。`.artifacts/logs-040/cleanup.json` に記録する。
- 大量ログの確認は疑似MCP通知、実承認は診断MCPを用いたLUNA上の隔離試験。KAGUYA実機・物理IMEの再確認や、実AppDock設定変更は行っていない。既存の通信・入力・会話コンテキスト等の制限や未対応要求への対応は変更していない。
- 本体変更、実利用先deploy、commit・push・Releaseは行っていない。将来の開発セット・会話再開機能は設計書に未実装として残し、通信ログの分離・保持枠回収だけを現行仕様へ反映した。

## 2026-10-25 0.5.0 旧表示設定との互換性修正

### 追加試験で判明した問題と修正

- 0.4.0発行後、旧displayMode:traceを残した設定で追加GUIを行ったところ、新しい通信スイッチの保存が本体の選択肢検証に拒否された。読取り時の互換処理だけでは不十分だった。失敗証跡 `.artifacts/logs-040/ui-1792875158861/`。
- 本体を変更せず、新しい表示選択をchatDisplayModeへ分離し、旧displayModeを保存したまま検証対象から外した。最初の修正ではnormalを新しい既定値にしたため、本体が既定値を省略すると旧traceの継承が再び有効になり、通常表示へ切り替えられなかった。失敗証跡 `.artifacts/logs-050/ui-1792875331270/`、`ui-1792875447526/`。待機や検査条件の緩和では解決せず、保存契約を修正した。
- 最終版のchatDisplayModeはinheritを既定とし、「既定（以前の選択／通常）」「通常」「詳細」を選択できる。inheritの場合だけ旧値を読み、新しいnormal／detailの明示選択を優先する。旧traceは詳細として扱い、通信ログは独立した初期オフのwireLogEnabledだけで有効にする。旧値の削除・書換え・自動移行は行わない。
- 設定キーの追加・削除を発行済み0.4.0の後に行ったため、共通規則に従い最終版を0.5.0とした。ログ回収・会話保持・秘密値除外は0.4.0の修正を維持した。修正差分と影響先を再レビューし、明示選択と継承、既定値省略、旧値を残した保存、通常／詳細と通信の独立性に未解決の指摘がないことを確認した。

### 修正後の検証

- 単体33/33・fail／skip 0、ビルド成功。共通Settingsの新キー優先、旧値の継承、独立した通信の有効化、保存値を変更しない読取り、設定購読の解除を追加確認した。証跡 `.artifacts/logs-050/test-1792875622488/`。
- GUI10群成功。旧traceを残したまま通信スイッチを保存でき、明示した通常／詳細へ切り替えられることを確認した。旧値はそのまま保持されていた。従来の大量ログ回収・会話保持・質問／承認・停止・新規会話・送信キー・配色・狭幅・再起動も成功。証跡 `.artifacts/logs-050/ui-1792875555088/`、画面／結果 `.artifacts/ui-1792875555995/`。
- 実Codex GUIも4モード・MCP承認回答・継承復元・開始時設定の切替に成功。証跡 `.artifacts/logs-050/approval-1792875627770/`、結果 `.artifacts/approval-ui-1792875628564/`。各工程は終了コード0・前後入力hash一致。GUI成功後の追加変更は単体試験と説明文で、GUI対象の実行コードは一致している。
- 試験環境は固定AppDock 0.87.4とCodex CLI 0.161.0。採用EXEのhashは上の0.4.0確認時と同一。0.5.0発行前の文書・構文・リンク・manifestとsettingDefaultsの一致検査も成功した。

### 最終発行物

- 発行先 `A:/40.ARTIFACT/Applet.ChatCodex.at365`。版0.5.0、最低ホスト版0.86.13、publish終了コード0・入力hash一致。証跡 `.artifacts/logs-050/publish-1792875696901/`。
- update.zipは31,678 bytes、SHA256 `da5416d04bf6126832c89bdf5922e0fd4162cf780a806b9fc716bbcff1ddd5de`。feedの版・サイズ・hash、ZIP全11ファイルと発行フォルダー、実行コード／manifest 10ファイルとソース、生成USAGEと利用仕様が一致。照合結果 `.artifacts/logs-050/publish-verification.json`。
- 発行済みフォルダーを指定したコピーで、旧traceの保持を含むGUI10群と実Codex GUIが成功した。証跡 `.artifacts/logs-050/ui-1792875710422/`、`approval-1792875729419/`。画面／結果は `.artifacts/ui-1792875711293/`、`.artifacts/approval-ui-1792875730240/`。終了コード0・前後入力hash・ログhash一致。
- 最終文書・文字コード・構文・ローカルリンク・設定既定値の検査は37ファイル、JS/CJS 19件、参照43件で成功。Git差分の空白検査も成功。`.artifacts/logs-050/document-check.json` に記録した。
- 成功した0.5.0のGUI／実承認profileは各2件で保持範囲内。試験プロセスの終了を確認し、解消済み失敗の調査資料と過去版の再利用証跡を保持した。削除対象なし。`.artifacts/logs-050/cleanup.json` に記録する。
- 今回の未確認範囲はKAGUYA実機・物理IME・実AppDock設定変更。会話再開・開発セットの機能は未実装のまま。本体変更、実利用先deploy、commit・push・Releaseは行っていない。

## 2026-10-25 0.5.0のコミット・プッシュ照合

- mainの8692cfa以降の通信ログ分離、種別ごとの上限回収・画面回収、旧表示設定の互換処理、試験と関連文書の18ファイルを対象とする。既存の未コミット変更を保持し、pull・統合は行っていない。差分と影響先を確認し、追加の修正指摘はなかった。
- 必要回帰は単体33件、ビルド・梱包、発行物GUI10群、実App ServerのMCP承認回答・4モード・継承復元・開始時設定切替。成功ログ・終了コード・前後入力hashと、現在のソース・試験・共有入力37件、採用Codex実行ファイルを照合し、すべて一致したため再利用した。未解決の失敗や追加実行が必要な回帰はない。
- 発行済み0.5.0のfeed・ZIP・全11ファイル、実行コード／manifest 10ファイルとソース、生成USAGEと利用仕様を再照合した。GUIと実Codex試験の隔離コピーにある実行コード／Web資産9ファイルも発行物と一致した。版・ZIPのサイズ・hashは発行時と同一で、再発行はしていない。
- 判定と照合は `.artifacts/commit-validation-050-20261025/reuse.json`、phase-comparison.json、environment.json、publish-verification.jsonへ記録した。今回実行した文書・文字コード・構文・ローカルリンク・設定既定値・差分検査は同ディレクトリのdocument-check.jsonで確認できる。製品修正は行わず、今回追加した内容はこの検証記録だけとする。
- 実効author／committerは `yukichi-7sai <yukichi@at365.jp>`。両リモートmainはプッシュ前に8692cfaと一致した。stage対象・作業ファイルとの一致・tree、commit後SHA、GitHub／AQUAのmain照合は同ディレクトリのstage.json、commit.json、push.jsonへ記録する。本体変更・実利用deploy・Releaseは行わない。
