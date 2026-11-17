# Kusakari Canvas 専用起動オーバーレイ（SysOverRay）

Windows 10/11 x64から、Kusakari EC内の3D庭づくり機能（Kusakari Canvas）のWebとAPIを起動・停止・再起動するローカル開発ツールです。ECとは開発用プロセスを分けていますが、利用者向けの独立サービスではありません。

## セットアップと起動

初回はリポジトリ直下の `setup.bat`（または `sysover-ray2\setup.bat`）を実行してください。.NET 10 Desktop Runtimeを確認し、デスクトップに `Kusakari Canvas SysOverRay` ショートカットを作成します。以後はそのショートカット、または `sysover-ray2\start.bat` を使います。PowerShellからはリポジトリ直下の `start.ps1`、または `sysover-ray2\start.ps1` を実行できます。

`start.bat` は、オーバーレイの画面をウィンドウタイトルで特定し、前面のウィンドウであることと、起動・停止・再起動のボタンがあることを確かめてから正常終了します。失敗したときはキー入力を待ちます。同じ実行ファイルの古いオーバーレイは終了してから新しく起動します。

## 操作

- **起動**: `start.ps1 -NoBrowser` を起動し、APIの `/api/assets` の応答とWebページを確認します。正常なAPIが既に動いていれば再利用します。
- **停止**: 設定したKusakari Canvasの起動スクリプト、Vite、uvに該当するプロセスを照合して終了します。ポート番号だけで別プロジェクトのプロセスを終了しません。
- **再起動**: 対象プロセスを停止して再起動します。停止中からも起動できます。
- **ブラウザを開く**: 現在検出したWebのURLを開きます。
- **×**: オーバーレイを隠します。通知領域から再表示またはオーバーレイ終了ができます。オーバーレイ終了ではKusakari Canvasを停止しません。

起動に失敗した場合は、今回起動したプロセスを停止します。MySQLサービスは停止しません。

## 停止の対象

オーバーレイが自分で起動したプロセスの記録だけでは、`start.bat` からの既存起動や、オーバーレイを開き直した後の停止・再起動ができません。そこで、設定されたプロジェクトの絶対パスとプロセスの実行コマンドを照合します。対象はそのフォルダーの起動スクリプト、Vite、`backend` を明示したuvプロセスとその子プロセスです。停止直前にもPID、生成時刻、コマンドを再確認します。オーバーレイ自身の起動分は停止シグナルを先に送ります。停止後は終了中のプロセスを再確認し、再起動前に対象の消失を確認します。

ポート番号だけで終了する方式はプロジェクトを識別できないため採用しません。そのため、同じプロジェクトフォルダーで複数起動したセッションは停止時にすべて終了します。MySQLサービス、照合対象の起動形式を使わない手動起動のプロセス、ブラウザのタブは対象外です。

## パスとポート

`app\overlay-settings.json` の `ProjectRoot` は、実行ファイルの位置を基準とするKusakari Canvasのリポジトリルートへの相対パスです。既定値 `..\..` は `sysover-ray2\app` からリポジトリルートを指します。カレントディレクトリには依存しません。リポジトリ一式を移動する場合は内部のフォルダー構成を保ち、新しい場所で `setup.bat` を実行してショートカットを更新してください。停止要求には `KUSAKARI_CANVAS_STOP_REQUEST_PATH` を使います。

Webは5173〜5199、APIは8080・18081〜18100から空きポートを選び、選択結果を画面に表示します。ポート競合時に範囲内のプロセスを一括終了しません。

ツールと専用MySQLは `%LOCALAPPDATA%\KusakariCanvas`、オーバーレイの操作ログとウィンドウ位置はWindowsのLocalAppData配下に保存します。`KUSAKARI_CANVAS_HOME` でツールと専用MySQLの保存先を変更できます。相対パスはプロジェクトルート基準です。`KUSAKARI_CANVAS_HOME` の変更だけでは既存のmanaged MySQLデータは移動しません。

## 配布ファイルの作り直し

開発側には.NET 10 SDKとWindows Desktop targeting packが必要です。利用者側はセットアップが.NET 10 Desktop Runtimeを確認し、不足時にユーザー領域へ導入します。`sysover-ray2` で次を実行します。

```powershell
dotnet build .\SysOverRay\SysOverRay.csproj -c Release
dotnet publish .\SysOverRay\SysOverRay.csproj -c Release -r win-x64 --self-contained false -o .\app
```

配布先の `app\overlay-settings.json` も更新してください。セットアップは現在のリポジトリを指すショートカットを作成し、旧ショートカットは同じ起動スクリプトを指す場合だけ削除します。

## 安全境界

本ツールはローカル開発用です。Kusakari Canvas APIは127.0.0.1に限定し、利用者はECのCognitoセッションで確かめます（`docs/cognito-auth.md`）。公開ネットワークへ露出する用途には使えません。画面タイトルと `X-Kusakari-Canvas-Backend` 応答ヘッダーをヘルスチェックで確認します。

## 検証

`sysover-ray2` で、実APIを使う起動・停止・再起動を確認する場合:

```powershell
dotnet run --project .\verification\LifecycleProbe\LifecycleProbe.csproj -c Release
```

`start.bat` から実画面と操作ボタンを確認する場合:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\verification\verify-launch-lifecycle.ps1
```

後者は実API・Web・Web経由API、起動プロセスの置換、停止後のLISTEN消失を確認します。検証後はオーバーレイとKusakari Canvasを起動状態にします。開いているオーバーレイの停止・再起動ボタンをUI Automationで操作する確認は `verification\verify-ui-controls.ps1` です。

どのスクリプトも結果のJSONと画面画像を `verification\` に書き出します。これらはGitに入れません。検証の記録は [kusakari-document の 開発環境とDB](https://github.com/abeouga/kusakari-document/tree/main/開発の記録/kusakari-canvas/開発環境とDB) か PR 本文に書きます。
