# 別PCでECのCognito認証を共用する

ECとCanvasを同じ親フォルダーの`kusakari-ec`、`kusakari-canvas`へ取得し、それぞれの`setup.bat`でそのPC専用のDB・依存を準備してください。

詳細な手順、User Poolの接続先、確認項目、別PCの出店者権限の設定は[EC側のセットアップ手順](https://github.com/abeouga/kusakari-ec/blob/main/docs/cognito-setup.md)にまとめています。

セットアップ後、ECルートから実行します。

```powershell
node scripts/configure-cognito.mjs --check
node scripts/configure-cognito.mjs
```

Canvasの`config/cognito.development.json`の公開設定と、EC側の同名設定を、それぞれのGit対象外`.env`へ反映します。各PCのDBパスワードとAPIキーは保持します。配置が違う場合は`--canvas-root PATH`を追加してください。

ECを先に起動し、次にCanvasを起動します。

- EC: http://127.0.0.1:5186/account/login
- Canvas: http://127.0.0.1:5173/
- Canvas API: http://127.0.0.1:8080/health/ready

ホスト名をlocalhost等と混在させず、固定ポートを空けてください。EC APIの8086への疎通が必要です。ECが停止している場合、認証済みの庭操作は失敗します。

Cognitoの利用者は共通ですが、各PCの庭データとEC側の会員ID・ロールは別DBです。新しいDBで初回ログインした利用者はUSERになるため、SELLERはEC側の手順でそのPCのDBへ設定します。既存の庭や会員権限を自動で移管しません。

AWSアクセスキーとOpenAI APIキーは、通常のログイン・庭保存には不要です。OpenAIキーなしでは有料AI機能を使いません。パスワード・トークン・CookieはGitHubへ保存しないでください。
