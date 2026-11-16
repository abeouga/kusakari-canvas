# 実装契約

## Context

この文書は、Kusakari EC内の3D庭づくり機能（Kusakari Canvas）の実装契約です。利用者向けのサービス境界はKusakari ECであり、このリポジトリは庭データの編集・表示・保存を担います。商品、価格、在庫、カート、注文の正本はKusakari ECです。利用者の認証はECのCognitoセッションを使います（[ECのCognitoログインとの共用](cognito-auth.md)、[EC連携](ec-integration.md)）。

## Decision

- Frontend: React 19 + JavaScript/JSX + Vite、R3F 9 + Drei 10、Zustand、TanStack Query。Viteの `/api` proxyで同一オリジン通信します。
- Backend: Python 3.12、FastAPI、Pydantic v2、同期SQLAlchemy 2、PyMySQL、MySQL、Alembic。庭の所有者はECで本人確認した会員IDで、ローカル起動は `KUSAKARI_CANVAS_HOST=127.0.0.1` に制限します。旧DBの引き継ぎは[FastAPI移行](fastapi-migration.md)に記録しています。
- 保存形式: `{schemaVersion:1,id,revision,name,width,depth,objects,photo,shoppingTargets}`。`photo`は`null`または元画像・内部の変換基準四隅・多角形輪郭・カメラ校正です（[写真と多角形地面](geometry-photo.md)）。`revision`は同時更新制御、`schemaVersion`は形式識別です。`shoppingTargets`は過去の必要数で、画面からは編集しません（[shopping-targets](shopping-targets.md)）。
- 配置物: `{id,assetId,position,rotation,scale}` に、商品から置いたものは `productId`・`productName`・`materialCode`・`modelComposition` を加えます。
- 単位: Three.js 1 unit = 1m。X/Zだけ庭の中心からの座標、配置Y=0、回転はY軸ラジアン、scaleはxyz同値の0.25..3です。配置数は200個まで、庭の各辺は1〜50mです。
- 配置アセットIDは `tree_oak`, `shrub_boxwood`, `brick_paver`, `bench_wood` と、植物の商品用の予約アセット `plant_modular` です。固定アセットのGLBはリポジトリへ同梱します（[ブラウザー用3Dアセット](assets.md)）。植物の商品は部品の構成で描画します（[植物モデル構成規則 v5](plant-assembly-v5.md)）。

## API契約

庭:

- `GET /api/assets` → `{id,name,category,modelUrl,baseDimensions:{width,height,depth}}[]`
- `GET /api/gardens` → `{id,name,width,depth,revision,updatedAt,objectCount}[]`
- `POST /api/gardens` `{name,width?,depth?}` → 新規GardenDocument（寸法の省略時は10m × 8m）
- `POST /api/gardens/{id}/duplicate` → 複製した庭の概要（[庭の複製](garden-duplication.md)）
- `GET /api/gardens/{id}` → GardenDocument
- `PUT /api/gardens/{id}` → revisionを含むGardenDocument全体。要求revision一致時だけトランザクション保存し、成功revisionを1増やします。
- `DELETE /api/gardens/{id}` → 204
- 不正入力400、所有者スコープ内の不存在404、revision競合409。エラー形式は `{status,code,message}`。

その他:

- 写真: `POST /api/photo-calibration`（[写真のカメラ校正](photo-camera-calibration.md)）
- サムネイル: `GET/POST /api/gardens/{id}/thumbnail`（[サムネイルの容量](thumbnail-upload-budget.md)）
- 買い物リスト: `GET /api/shopping-lists`、`GET /api/gardens/{id}/shopping-list`（[庭の買い物リスト](garden-shopping-lists.md)）
- 植物モデル: `GET /api/model-parts`、`POST /api/model-assemblies/resolve`
- AI画像生成と生成履歴: `/api/ai/*`、`POST /api/gardens/{id}/ai-image`、`/api/gardens/{id}/image-history`（[完成イメージとAI画像生成](image-studio.md)）
- 認証の状態: `GET /api/auth/status`。ヘルスチェック: `/health/live`、`/health/ready`

## データフローと失敗処理

操作 → 検証済み編集操作 → ZustandのGardenDocument → R3F表示。変更が落ち着いた時点でスナップショットを自動でPUTし、成功時に応答revisionで確定します（[庭エディタの画面構成と自動保存](workspace-ui.md)）。保存中も編集でき、失敗時は編集内容と未保存の状態を保持して再試行を表示します。ロード失敗は再試行を提示します。GLB失敗は他のモデル表示を止めず、対象削除または再試行へ誘導します。サーバーも庭寸法・配置数・座標・倍率・固定軸・assetId・ID重複・植物の構成を検証します。

写真表示では透明なR3Fキャンバスを元画像に重ね、同じGLBを描画します。写真と3D庭はGardenModelの読み込み・失敗表示とGardenGroundの配置ルールを共有します。カメラは保存済みの地面変換・カメラ校正と庭寸法から再生成する表示状態であり、GardenDocumentやDBへThree.jsオブジェクトを保存しません。

## Alternatives / Consequences

GardenDocumentとThree.jsのランタイムを分離するため、表示実装を替えても保存形式を維持できます。ownerは必ずサーバーが決定し、別会員の庭・写真・履歴の参照・更新を拒否します。固定所有者は明示的な隔離試験設定以外で使用できません。

## Rollback

DBはAlembicで作成・更新します（`backend/alembic/versions/` の0001〜0008）。旧Flyway V1/V2 DBは構造・履歴照合とバックアップ後に対応版として記録し、既存データとFlyway履歴を維持します。既存スキーマを破壊するマイグレーションや起動時のテーブル再作成は行いません。開発用・E2E用のDBを作り直すときだけ `DB-reset.bat` を使います（[DBの初期化](database-reset.md)）。GardenDocumentはschemaVersion 1で保存し、将来形式変更時は読み書き互換を別途決定します。
