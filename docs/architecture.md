# 実装契約

2026-10-19追記: ECのCognitoセッションを使用する認証モードと利用者別の所有者解決を追加しました。
通常起動は実Cognitoに接続するECのセッションを使用します。設定不足・通信失敗では認証を省略しません。[cognito-auth.md](cognito-auth.md)と[EC連携](ec-integration.md)を参照してください。

## Context

この文書は、Kusakari EC内の3D庭づくり機能（Kusakari Canvas）のローカル試作に関する実装契約です。利用者向けのサービス境界はKusakari ECであり、このリポジトリは庭データの編集・表示・保存を担う技術試作です。初期MVPでは人が編集するGardenDocumentを中心にし、AI、認証基盤、クラウド、物理エンジンは導入しません。商品、価格、在庫、カート、注文の契約はKusakari側の設計資料を正本とします。

## Decision

- Frontend: React 19 + JavaScript/JSX + Vite、R3F 9 + Drei 10、Zustand、TanStack Query。Viteの `/api` proxyで同一オリジン通信します。
- Backend: Python 3.12、FastAPI、Pydantic v2、同期SQLAlchemy 2、PyMySQL、MySQL、Alembic。庭の所有者はECで本人確認した会員IDで、`KUSAKARI_CANVAS_HOST=127.0.0.1` に制限します。移行判断と旧DB引き継ぎは`docs/fastapi-migration.md`に記録します。
- 保存形式: `{schemaVersion:1,id,revision,name,width,depth,objects,photo}`。`photo`は`null`または元画像・内部の変換基準四隅・多角形輪郭です。新しい輪郭の四隅は外接矩形から自動生成し、ユーザーが別途4点をクリックする入力段階はありません。旧保存データの基準は輪郭編集前まで保持します。`revision`は同時更新制御、`schemaVersion`は形式識別です。写真追加は既存形式の任意項目として扱います。
- 単位: Three.js 1 unit = 1m。X/Zだけ庭の中心からの座標、配置Y=0、回転はY軸ラジアン、scaleはxyz同値の0.25..3です。
- 配置アセットIDは `tree_oak`, `shrub_boxwood`, `brick_paver`, `bench_wood` とし、GLBはリポジトリへ同梱します。生成元はこのリポジトリの基本形状スクリプトです。

## API契約

- `GET /api/assets` → `{id,name,category,modelUrl,baseDimensions:{width,height,depth}}[]`
- `GET /api/gardens` → `{id,name,width,depth,revision,updatedAt}[]`
- `POST /api/gardens` `{name,width,depth}` → 新規GardenDocument
- `GET /api/gardens/{id}` → GardenDocument
- `PUT /api/gardens/{id}` → revisionを含むGardenDocument全体。要求revision一致時だけトランザクション保存し、成功revisionを1増やします。
- `DELETE /api/gardens/{id}` → 204
- 不正入力400、所有者スコープ内の不存在404、revision競合409。エラー形式は `{status,code,message}`。

## Alternatives / Consequences

GardenDocumentとThree.jsのランタイムを分離するため、表示実装を替えても保存形式を維持できます。ownerは必ずサーバーが決定し、別会員の庭・写真・履歴の参照・更新を拒否します。固定所有者は明示的な隔離試験設定以外で使用できません。

## データフローと失敗処理

操作 → 検証済み編集操作 → ZustandのGardenDocument → R3F表示。保存ボタン時だけスナップショットをPUTし、成功時に応答revisionで確定します。保存中は編集を抑止し、失敗時は編集内容とdirty状態を保持して再試行を表示します。ロード失敗は再試行を提示します。GLB失敗は他のモデル表示を止めず、対象削除または再試行へ誘導します。サーバーも庭寸法・配置数・座標・倍率・固定軸・assetId・ID重複を検証します。

写真表示では透明なR3Fキャンバスを元画像に重ね、固定カメラで同じGLBを描画します。写真と3D庭はGardenModelの読み込み・失敗表示とGardenGroundの配置ルールを共有します。カメラは保存済み地面変換と庭寸法から再生成する表示状態であり、GardenDocumentやDBへThree.jsオブジェクトを保存しません。詳細は[photo-tree-overlay.md](photo-tree-overlay.md)を参照してください。

## Rollback

初期DBはAlembic 0001で作成し、写真保存列を0002で追加します。旧Flyway V1/V2 DBは構造・履歴照合とバックアップ後に対応版として記録し、既存データとFlyway履歴を維持します。既存スキーマを破壊するマイグレーションや起動時のテーブル再作成は行いません。GardenDocumentはschemaVersion 1で保存し、将来形式変更時は読み書き互換を別途決定します。投影方法と制約は`docs/geometry-photo.md`を参照してください。
