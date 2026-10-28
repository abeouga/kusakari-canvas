# 庭の買い物リストとECカート

## Context

従来のCanvas右パネルは、全庭で共通のECカートを表示・編集していた。2026-10-16の要件変更により、右パネルを庭ごとの買い物リストへ変更する。

## Decision

- 買い物リストは庭の配置から集計する。配置1個を1点として、商品IDがある配置は商品ごと、旧配置はアセットごとに集約する。別のリスト保存テーブルは持たない。
- Canvasの右側は「商品一覧」「買い物リスト」。商品一覧・買い物リストからのドラッグで配置できる。リストの数量は配置の追加・複製・削除で変わり、リストだけの数量変更や削除は提供しない。
- CanvasからECカートを更新するAPI呼び出しは行わない。共通ヘッダーのカート件数・選択店舗の参照は維持する。
- 配置操作の確定から500ms後に既存の庭スナップショットを自動保存する。同時に編集中だった有効な庭設定も同じスナップショットに保存される。操作中、写真の輪郭編集中、カメラ設定中は保存を保留する。
- 保存失敗時はローカル編集内容を保持して未反映を表示する。自動再試行を繰り返さない。再試行は保存ボタン、競合は最新の庭内容を確認して解消する。
- ECへ進むボタンは保存を完了してから遷移する。保存に失敗した場合はCanvasに留まる。
- EC `/cart` に庭別一覧、`/cart/gardens/{gardenId}` に商品選択画面を設ける。初期未選択、全選択・選択解除・個別選択を提供する。商品候補が複数ある旧配置は、購入商品を選んでからチェックする。
- EC画面は3秒間隔と画面復帰時に再取得する。庭の版変更でチェックを解除し、更新を通知する。受取店舗と商品価格・在庫はECを正本とする。
- 選択分は既存カート数量に加算する。購入可能な商品を追加し、在庫不足・販売終了・99点超過・50種類超過は商品単位で見送る。数量を自動で減らさない。判定順はリストの表示順、同じ購入商品への数量は合算する。
- 成功分は1トランザクション、カートrevisionは成功があった場合だけ1増える。庭・カートの古いrevisionは409として全件を再確認させる。同じ要求の再送で数量が二重加算されない。追加操作は自動再送しない。
- 一部成功ならECカートへ移動し、見送り理由とリストへ戻る導線を表示する。全件見送りなら詳細画面に留まる。追加後も庭のリストは残る。

## API

Canvas:

- `GET /api/shopping-lists`：所有者の庭別概要。空の庭を含む。
- `GET /api/gardens/{id}/shopping-list`：庭ID・名前・revision・更新日時と、行キー・商品ID・材料コード・数量・単位。写真と3D構成は含めない。

EC:

- `GET /api/shopping-lists`：Canvasの庭別概要。
- `GET /api/shopping-lists/{gardenId}`：現在の受取店舗・軽量な購入商品候補を付加した詳細。
- `POST /api/cart/shopping-lists/{gardenId}/items`：`gardenRevision`、`cartRevision`、`items: [{key, productId}]` を受け取る。数量は保存済みの庭から再取得し、クライアント指定の数量は受け付けない。更新後のカートとadded/skippedを返す。

CanvasとのHTTP通信を終えてからECカートの書き込みロックを取得する。所有者はサーバーで決定し、現行ローカルデモの所有者制限を維持する。本番認証の追加はこの変更に含めない。

## Alternatives

独立した買い物リストの編集・保存は、配置数量と常時連動する要件に合わない。Canvasでカートへ追加する方式と、リスト全件を無選択で追加する方式は採用しない。

## Consequences

DBスキーマとGardenDocumentの形式は変更しない。既存の庭は配置からリストが得られ、既存ECカートの内容は保持される。カートの商品は庭の変更で増減しない。未配置の商品は庭のリストには載らず、ECの商品一覧から通常どおり購入する。

旧Canvas内カートを前提とした統合検証も、買い物リスト方式へ更新する。現行の完了条件は `test:shopping` とEC側の統合・回帰テストとする。

## Verification

ECで `npm run build:api` の後、Canvasで `npm run test:shopping`。ECの既存出品・購入の回帰確認はECで `npm run test:shopping-regression`。EC起点の統合確認はECで `npx playwright test --config playwright.integration.config.js`。すべて実APIと専用MySQLを使用する。

所有者分離は固定所有者の画面から切り替えられないため、別所有者の一時庭を専用MySQLへ作成する `verification.verify_shopping_lists` で独立確認する。実FastAPIを通して一覧の非表示・詳細404・クライアントownerIdの無効を確認し、一時庭を削除する。

画面と庭JSONは `artifacts/e2e/shopping-lists/`、E2E結果は同フォルダの `results.json` に保存する。


## 2026-10-17: 庭のサムネイル

### Context

ECの庭別一覧で庭の見た目を判別できるようにする。

### Decision

最新の保存済み生成履歴のAfter画像、現行revisionのCanvasキャプチャ、現行配置図の順で取得する。`GET /api/gardens/{id}/thumbnail` は所有者を確認して縮小PNGを返す。一覧は `thumbnailVersion` のみ返す。

`POST /api/gardens/{id}/thumbnail` は画像サイズとrevisionを検証し、Alembic 0006の `garden_thumbnails` へ保存する。庭のrevisionや配置・生成履歴を変更しない。古いキャプチャは表示せず配置図へ戻す。Canvas画面の描画・保存完了後に小さなキャプチャを取得する。

### Alternatives

サムネイル目的の外部AI呼び出しや、画像のない庭を無表示にする方式は採用しない。

### Consequences

未撮影の旧庭も配置図を取得できる。生成画像は生成当時の配置を表す。生成履歴を削除すると次の候補へ切り替わる。新規テーブル以外の既存データは維持する。EC側の `docs/cart-ux-and-demo-products.md` に画面・検証結果を記録する。

## 2026-10-23: ECで追加した商品をCanvasのリストに表示し、配置で二重に数えない

### Context

ECの「買い物リストに追加」で保存した商品（EC側 `garden_shopping_items`）が、Canvasの右パネルには表示されなかった。また、EC側で「配置数＋EC追加分1点」と合算していたため、ECで追加した商品をCanvasで1個置くと必要数が2点になっていた。

### Decision

- ECで追加した商品は「この庭に1点以上必要」という意味で扱う。必要数は `max(配置数, 1)` とする。配置がなければ1点、配置があれば配置数のままとする。ECの庭別一覧・詳細・カート移送はすべてこの計算による。
- Canvasは、ECの `GET /api/shopping-lists/{gardenId}/saved-items`（会員カートIDで絞り込んだ商品IDと商品名、`listRevision`）を取得し、編集中の配置から作ったリストと画面上で合成する。EC追加分の正本はECのままで、CanvasのDBやGardenDocumentへは複製しない。
- まだ配置していないEC追加分は「ECで追加（庭に未配置）」と表示する。商品一覧と同じように、ドラッグまたは「庭に配置」で配置できる。取得に失敗した場合は配置分だけを表示し、取得できなかったことを通知する。

### Alternatives

Canvas側へEC追加分を同期・保存する方式は、正本が2か所になるため採用しない。ECの詳細APIを使う方式は、保存済みの配置と合算済みの値しか返さず、未保存の配置と合成できないため採用しない。

### Consequences

DBスキーマとGardenDocumentの形式は変更しない。Canvasで配置をすべて削除しても、EC追加分の1点は残る（ECでのリストからの削除は引き続き対象外）。ECの別タブで追加した商品は、Canvasの画面に戻ったときの再取得（10秒のキャッシュ後）で反映される。

### Verification

ECで `npx playwright test --config playwright.shopping-picker.config.js`（実Cognito・実API・専用MySQL）の「a product saved from EC appears in the Canvas list…」で確認する。ECで追加 → Canvasで1点・未配置表示 → 1個配置しても1点 → 2個で2点 → 再読み込み後も2点、ECの詳細も同じ数量であることを確かめる。画面とJSONはEC側の `artifacts/shopping-picker/canvas-ec-item-*` に保存する。CanvasとECの両方を認証付きで起動する構成がEC側にあるため、検証はEC側に置く。
