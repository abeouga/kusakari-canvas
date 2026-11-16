# ECのCognitoログインとの共用

## Context

CanvasはKusakari ECの一部で、利用者の認証はECが行います。Canvasは従来、dev/e2e/containerごとの固定所有者を使っていました。庭・写真・履歴は、ECで本人確認した会員ごとに分ける必要があります。

## Decision

- 通常起動は`KUSAKARI_AUTH_MODE=cognito`です（`auth.py`の既定値）。`KUSAKARI_CANVAS_AUTH_EC_URL`には信頼するEC APIオリジン（既定は`http://127.0.0.1:8086`）を指定します。HTTPは127.0.0.1・localhostだけを受け付け、それ以外はHTTPSに限ります。
- Cookie `KUSAKARI_SESSION`をECへ照会し、返された会員IDを所有者とします。読み取りはECの`/api/auth/me`、更新系はCSRFトークンを付けて`/api/auth/verify`で確かめます。庭・写真・履歴・サムネイル・買い物リスト・AI生成の全経路に適用します。認証なしで使えるのは、ヘルスチェック、`GET /api/assets`、`GET /api/model-parts`、`GET /api/auth/status`だけです。
- 未ログインは401、確認情報・権限の不足は403、認証先の障害や想定外の応答は503で拒否します。署名のない利用者ヘッダーやクライアント指定のownerIdは信用しません。ECとの認証確認に失敗しても固定所有者へ切り替えません。
- 店舗側のアカウント（`SHOP_OWNER`・`SHOP_STAFF`・`SHOP_OWNER_APPLICANT`）は403（`BUYER_ACCOUNT_REQUIRED`）にします。例外は植物モデルの組み立て（`POST /api/model-assemblies/resolve`）だけです。詳しくは[EC連携](ec-integration.md)にあります。
- 固定所有者（`KUSAKARI_AUTH_MODE=demo`）は、E2Eのプロファイルで`KUSAKARI_TEST_AUTH=true`を明示した隔離試験だけで使えます。それ以外で指定すると起動時に止まります。
- 既存庭の所有者をテスト利用者へ自動で書き換えません。

## 画面の動き

未ログインでCanvasを開くと、ECの`/account/login?returnTo=元のCanvasのURL`へ自動転送します。Canvas内にはログインフォームを設けません。ログイン成功後は元のCanvas画面へ戻ります。未保存の編集がない画面でCanvas/EC APIが401を返した場合も同じEC画面へ転送します。未保存の編集がある場合は転送せず編集内容を保持し、別ウィンドウでECへ再ログインしてから保存を再実行します（[編集中のログイン期限切れ](session-expiry-edits.md)）。403や503では自動転送せず、エラーを表示します。

## 別PCでの設定

ECとCanvasを同じ親フォルダーの`kusakari-ec`、`kusakari-canvas`へ取得し、それぞれの`setup.bat`でそのPC専用のDB・依存を準備します。手順、User Poolの接続先、確認項目は[EC側のセットアップ手順](https://github.com/abeouga/kusakari-ec/blob/main/docs/cognito-setup.md)にまとめています。

セットアップ後、ECのルートから実行します。

```powershell
node scripts/configure-cognito.mjs --check
node scripts/configure-cognito.mjs
```

Canvasの`config/cognito.development.json`の公開設定と、EC側の同名設定を、それぞれのGit対象外`.env`へ反映します。各PCのDBパスワードとAPIキーは保持します。配置が違う場合は`--canvas-root PATH`を追加します。

ECを先に起動し、次にCanvasを起動します。

- EC: http://127.0.0.1:5186/account/login
- Canvas: http://127.0.0.1:5173/
- Canvas API: http://127.0.0.1:8080/health/ready

ホスト名をlocalhost等と混在させず、固定ポートを空けてください。EC APIの8086への疎通が必要です。ECが停止している場合、認証済みの庭操作は失敗します。

Cognitoの利用者は共通ですが、各PCの庭データとEC側の会員ID・種別は別DBです。既存の庭や会員の種別を自動で移管しません。User Poolとテスト用アカウントは隣接する`kusakari-terraform`で管理します。

AWSアクセスキーとOpenAI APIキーは、通常のログイン・庭保存には不要です。OpenAIキーなしでは有料AI機能を使いません。パスワード・トークン・CookieはGitHubへ保存しないでください。

## Alternatives

Canvas専用ログインは作らず、ECのセッションを共有します。認証に失敗したときに固定所有者で続ける方式は、別会員の庭を扱う危険があるため採用しません。

## Consequences

EC停止中は認証済み操作も停止します。認証境界の全体仕様はECの`docs/cognito-auth.md`を参照します。
