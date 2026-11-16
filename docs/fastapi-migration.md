# FastAPI移行

この文書は、旧Greenly試作からFastAPIへ移行した際の履歴です。現在のAPI識別ヘッダーは`X-Kusakari-Canvas-Backend`です。旧名は履歴説明だけで、現行設定では読み込みません。

## Context

Spring Boot/JPA/FlywayをPython APIへ置換し、既存API、MySQL、schemaVersion 1、写真・輪郭を含む現在の作業状態を維持する。Javaを完全にAPI起動依存から外すという選択により、マイグレーション管理もAlembicへ移す。

## Decision

Python 3.12、FastAPI、Pydantic v2、同期SQLAlchemy 2、PyMySQL、Alembic、Pillowを使う。`backend/pyproject.toml`と`uv.lock`で依存を固定する。HTTP DTO・ドメイン検証・ORMを分け、同期ルートでリクエスト単位のSessionを使用する。更新・削除はowner付きSELECT FOR UPDATEで庭行をロックし、revision比較から配置全置換までを一つのトランザクションで処理する。Sessionを共有せず、失敗時は全変更をrollbackする。日時はMySQLセッションUTC、応答はUTCのISO 8601。

URL/JSON/ステータス/日本語エラーを維持する。Pydanticの形式エラーは400 INVALID_REQUEST、ドメインエラーは既存code、DB整合性競合は409 STORAGE_CONFLICT。未知項目も拒否する。`photo`省略/nullは写真なし。旧Java APIの誤再利用防止には当時`X-Greenly-Backend: fastapi`を使い、現行は`X-Kusakari-Canvas-Backend: fastapi`を使う。

移行時はdev/e2eで固定ownerをサーバー決定していた。現在の所有者はECのCognitoセッションの会員IDで、固定ownerは明示した隔離E2Eだけで使う（[ECのCognitoログインとの共用](cognito-auth.md)）。APIは127.0.0.1へbindする。現行の環境変数は`KUSAKARI_CANVAS_PROFILE`、`KUSAKARI_CANVAS_HOST`、`KUSAKARI_CANVAS_PORT`、`KUSAKARI_CANVAS_DB_*`、`KUSAKARI_CANVAS_E2E_DB_*`。devは`.env`、e2eは`.env.e2e`だけを読み、プロセス環境変数を優先する。devは`kusakari_canvas`、e2eは`kusakari_canvas_e2e`から始まる専用DBを使う。DB資格情報はWebプロセスへ渡さない。

## Migration

`npm run migrate:api`およびAPI起動前に安全な移行処理を行う。DBごとのMySQL advisory lockで並行移行を防ぎ、既存テーブル名・列・型・nullable・主キー・索引・外部キー・InnoDBと履歴を照合する。

- 空DB: Alembic 0001(旧V1のSQLをそのまま実行) → 0002(旧V2のphoto_json追加)。
- Flyway V1: 構造照合 → mysqldumpバックアップ → 0001 stamp → 0002 upgrade。
- Flyway V1+V2: 構造照合 → バックアップ → 0002 stamp。既存データやFlyway履歴には書き込まない。
- Alembic 0002: 構造照合後、そのまま起動。0001ならバックアップ後にupgrade。
- 履歴不明・失敗履歴・未知版・構造不一致: stamp/DDLを開始せず終了。

バックアップはGit外の`%LOCALAPPDATA%\KusakariCanvas\backups`へ保存する。`KUSAKARI_CANVAS_BACKUP_DIR`で変更できる。mysqldumpが見つからない、権限不足、バックアップ失敗なら既存DBを変更しない。パスワードをコマンド引数やログへ載せない。MySQL DDLは非原子的なので、中断した不完全な移行は構造不一致として止め、バックアップからの復旧と原因修正を行う。写真列や庭を消す自動downgradeは提供しない。

## Alternatives / Consequences

Flyway実行を残すとJava依存が必要になるため採用しない。async ORM/driverは今回のローカルAPIの移行に必要な変更ではないため、同期処理を選ぶ。認証・公開運用への移行はこの移行に含めず、認証は後に別の変更で加えた。旧Javaソースの作業状態は削除前にGit外へ退避し、無関係なフロント/オーバーレイ変更を保つ。

## Verification

Chromiumの実ポインターE2Eを主要な受入検証とし、実FastAPI・専用MySQLを使う。API/DB独立検証は、通常のブラウザーE2Eで同時PUTの行ロック、途中の整合性違反による全rollback、owner分離、既存Flyway DB採用/新規DB作成を確実に再現できないため追加する。単純な実装の写しとなるユニットテストは追加しない。

`npm run verify:api`は専用DBへ実HTTPを送り、固有名の一時DBで移行経路を検証する。自身が作成した庭・一時DBだけを削除する。レポート/ログは`artifacts/fastapi`、ブラウザーの保存JSON・スクリーンショットは`artifacts/e2e`へ保存する。実利用者データや資格情報は成果物へ含めない。
