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
