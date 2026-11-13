# EC連携

Context: 2026-10-11の機能要件61項目に基づき、ECの一部としてCanvasを扱います。

Decision: 商品・価格・在庫・カート・注文はECが管理します。Canvasは庭の配置に連動する買い物リストを表示し、ECで購入する商品を選んでカートに追加します。配置の確定後は庭を自動保存します。現行のAPI・画面・検証方法は [庭の買い物リスト](garden-shopping-lists.md) に記載します。

Alternatives: Three.jsオブジェクトや写真をECへ渡す方法、Canvas側で価格・在庫を保存する方法は採用しません。

Consequences: ECとCanvasを両方起動してください。通常は5186/5173です。Canvasのルート.envにVITE_KUSAKARI_EC_URLを設定できます。4種類の対応商品はECのFlyway V3で追加します。数量は配置個数であり面積ベースBOMではありません。

旧条件別サンプルの植物候補は現在提供しません。完成イメージは既存の画像生成APIと保存履歴を使用します。計測は既存の写真投影と実寸設定に基づく推定です。

庭複製は既存create/get/save APIを利用し、庭と配置物のIDを新しくします。保存途中に失敗した場合は新しく作られた空の庭を一覧に残して明示し、元の庭を変更しません。

未保存の庭からECへ進む場合は保存して進む/保存せず進む/取消を選べます。描画中の輪郭やカメラ設定は確定してから保存します。保存に失敗した場合は編集内容を保持して画面に留まります。

全要件の対応表は隣接ECプロジェクトのdocs/functional-requirements.mdにあります。

2026-10-11: ECのファビコン画像（kusakari_ico.png）をタブとヘッダーに使用します。ECとCanvasのロゴ画像を統一します。768px以下では庭一覧・編集画面を縦に並べます。


## 2026-10-13: Canvas内の商品候補・カート（旧仕様）

以下は変更履歴です。2026-10-16に庭別の買い物リストへ置換済みで、Canvasからのカート更新は現在提供しません。

Context: 庭を編集中に候補商品を選び、同じECカートを操作できるようにする。

Decision: Canvasは `VITE_KUSAKARI_EC_URL` の `/api/cart`、`/api/materials/quote`、`/api/cart/items/{productId}` にcredentials=includeで接続する。受取店舗はECカートのstoreIdを使用する。素材の種類・個数・店舗を候補クエリのキーにし、座標・回転・倍率の変更では再取得しない。未対応素材や99個超過は素材ごとに表示する。追加は現数量への加算、更新は指定数量、削除は0としてrevision付きで送る。更新競合・通信失敗では最新カートを取得し、操作を自動再送しない。

共通ヘッダーと右サイドバーは同じTanStack Queryキャッシュを参照する。タブ切替・ウィンドウへの復帰でECカートを再取得する。庭の配置変更からカートを自動更新しない。商品価格・在庫・カートはECの正本を使用し、Canvas DBには保存しない。

ECの許可Originは `KUSAKARI_EC_CANVAS_ORIGIN`（通常http://127.0.0.1:5173、統合E2Eでは15173）で設定する。EC ViteはAPIのCORS処理をバックエンドへ委ねる。ローカルでは同一ホスト127.0.0.1・異なるポートでHttpOnly/SameSite=Strict/path=/apiの既存Cookieを共有する。localhostと127.0.0.1を混在させない。公開環境では既定の同一サイト構成に合わせてOrigin・Cookieを構成する。

Alternatives: Canvas専用カートの作成やCookieをJavaScriptでコピーする方法は採用しない。

Consequences（現在）: EC停止時は認証を確認できず保存できません。編集中の内容を保持し、サイドバーで再試行できる。注文手続きとヘッダーの「ECでカートを確認」は未保存確認を経由してEC /cartへ移動する。

## 2026-10-20 商品の引き継ぎと認証

ECの商品詳細・カートから `?productId=...` を保持してCanvasへ移動します。庭選択・新規作成後に対応モデルを選択状態にし、利用者が地面をクリックするまで配置しません。GardenDocumentへproductId・モデル構成・座標を保存します。庭の買い物リストとECカートの数量は連動変更しません。非公開商品は新規購入を拒否し、保存済み配置は保存したモデル構成から復元します。

通常の庭所有者はECのCognitoセッションから取得します。固定所有者は明示した隔離試験設定以外で使用できません。ECのOrigin制限フィルターは認証より先に、許可されたEC/Canvasの接続元を検証します。認証・CSRF・所有者確認は省略しません。

実Cognito・専用MySQLでの両アプリ試験はEC側 `npm run test:business` で実行します。資格情報を含むtrace/HARは記録しません。

## 2026-11-12 EC の新しい DB 構成（v3）への追従

Context: EC で、商品がそれぞれ1つの店舗に属する形に改め、カートの「閲覧中の店舗」をなくした（abeouga/kusakari-ec#107・#119）。Canvas は、カートの店舗を使って商品一覧と AI の候補を取っていたため、そのままでは商品一覧を取得できない。EC のログイン情報の応答も、`role` から `accountType` に変わった。

Decision:

- 商品一覧は、EC の `GET /api/products`（店舗の指定なし）から取る。全店舗の、購入者に見える商品が対象になる。
- AI の商品候補（`POST /api/materials/quote`）は、`storeId` に `null` を渡して全店舗から探す。AI 画像生成のリクエスト（`POST /api/gardens/{id}/ai-image`）と、候補の取得（`GET /api/ai/candidates`）から `storeId` をなくした。
- ヘッダーの「出店者」「管理者画面」の表示は、`accountType`（`SHOP_OWNER`・`SHOP_STAFF`・`ADMIN`）で決める。
- 買い物リストの「この店舗の販売対象ではないため購入できません」を、「現在は販売されていないため購入できません」に変えた。
- GardenDocument の形は変えない。商品から店舗が決まるので、配置に店舗を持たせる必要がないため。

Alternatives: AI のリクエストに `storeId` を任意の項目として残す案は採用しない。使われない項目が残り、店舗を選べるように見えるため。

Consequences: 庭の持ち主は今までどおり EC の会員 ID（UUID）で、DB の変更はない。EC と Canvas の DB は、両方を初期化する必要がある（[手順](database-reset.md)）。次のものは含めていない。店舗側のアカウントに Canvas を使わせない制限（#64）。配置した商品が買えなくなったときに配置を外す処理、配置と買い物リストへの店舗名の表示、「在庫なし」の表示（#65）。E2E の準備では、テスト用の出店者を「サンプルの店舗1の MANAGER の担当者」として作る。


## 2026-11-12 Canvas を購入者のアカウントだけにする（#64）

Context: EC の会員の種別が5つ（`USER`・`ADMIN`・`SHOP_OWNER`・`SHOP_STAFF`・`SHOP_OWNER_APPLICANT`）になり、店舗側のアカウント（オーナー・担当者）と申請中のアカウントは購入できないと決まった（abeouga/kusakari-ec#108・#109、2026-11-12 の決定）。Canvas は庭の配置から EC の買い物リストへ商品を送る購入者の機能なので、購入できないアカウントが庭を作っても使い道がない。Canvas はこれまで、ログインしているかと会員 ID だけを見て、種別を見ていなかった。

Decision:

- 画面：EC の `GET /api/auth/me` の `accountType` が `SHOP_OWNER`・`SHOP_STAFF`・`SHOP_OWNER_APPLICANT` のとき、庭の一覧・編集画面を出さずに「Canvas は購入者のアカウントで使えます。」と案内し、EC のトップへ戻るリンクを出す（`AuthGate`）。
- API：`auth.py` は、EC から受け取ったログイン情報（読み取りは `/api/auth/me`、書き込みは `/api/auth/verify`）の `accountType` が上の3つなら、403（`BUYER_ACCOUNT_REQUIRED`、「Canvas は購入者のアカウントで使えます。」）を返す。`USER` と `ADMIN` は今までどおり使える。知らない種別や種別のない応答は、認証を確かめられないものとして 503 にする。
- 例外：植物モデルの組み立て（`POST /api/model-assemblies/resolve`）と、植物のプレビュー画面（`/model-preview`）は店舗側のアカウントにも開く。EC の出店者の商品登録が、プレビューを枠で表示し、保存のときに EC のサーバーから出店者のログイン情報でこの API を呼ぶため。庭のデータは扱わない計算だけの API で、ログインは引き続き必要。

Alternatives:

- 店舗側のアカウントにも Canvas を使わせる案は採用しない。店舗側は購入できないと決まっており、庭から買い物リストへ送る導線が使えないため。
- 植物モデルの API も止める案は採用しない。出店者が植物の商品を登録できなくなるため。
- EC の `/api/auth/verify` が種別で拒否するのを待つ案は採用しない。読み取り（`/api/auth/me`）は拒否されないので、Canvas の側で種別を見る必要がある。

Consequences: 店舗側・申請中のアカウントで Canvas を開くと、案内だけが出て、API も 403 を返す。運営（`ADMIN`）は今までどおり使える。E2E は、Canvas と買い物リストを購入者のテストアカウント（`test.user@example.com`、`USER`）で、商品の登録・変更・削除を出店者のテストアカウント（`test.seller@example.com`、店舗1の MANAGER）で行う。`e2e/buyer-only.spec.ts` で、テスト用の出店者の種別を EC の E2E 用 DB で `SHOP_STAFF`・`SHOP_OWNER`・`SHOP_OWNER_APPLICANT`・`ADMIN` に変えて確かめ、終わったら元に戻す。


## 2026-11-13 買えなくなった商品の配置を外し、店舗名と在庫なしを出す（#65）

Context: EC で商品がそれぞれ1つの店舗に属し、店舗の閉鎖・停止、組織の停止、商品の削除で買えなくなるようになった（abeouga/kusakari-ec#109・#119・#79）。EC のカートは、戻らない理由で買えなくなった明細を開いたときに外して知らせる（2026-11-12 の決定）。庭には GardenDocument に productId だけを持つ配置が残り、Canvas は買えるかどうかも、どの店舗の商品かも出していなかった。EC の商品の一括照会 `POST /api/products/references` は、削除済みの商品も含めて `storeName`・`stock`・`purchasable`・`unavailableReason` を返す。

Decision:

- 庭を開いたとき、画面が配置済みの productId（と EC で買い物リストに入れた商品）を EC の一括照会で1回調べる。`unavailableReason` が `DELETED`・`STORE_CLOSED`・`STORE_SUSPENDED`・`ORGANIZATION_SUSPENDED`（戻らない理由。EC の `CatalogService.REMOVED_REASONS` と同じ）の配置を編集中の GardenDocument から外し、今の自動保存で1回保存する（新しい revision）。GardenDocument の形は変えない。外した商品は「○○の商品は購入できなくなったため、庭から外しました。」とポップアップで知らせる。
- 在庫0（`OUT_OF_STOCK`）・非公開（`HIDDEN`）・閉鎖予定（`STORE_CLOSING`）・店舗の非公開（`STORE_UNPUBLISHED`）・組織の受付停止（`ORGANIZATION_NOT_ACCEPTING`）・商品の停止（`PRODUCT_SUSPENDED`）は一時的なので配置を残し、買い物リストに在庫0なら「在庫なし」、それ以外なら「現在は購入できません」と出す。
- 照会に失敗したとき（EC が止まっている、通信が切れた、照会した ID のどれかが EC に無く 404 が返った）は、買えるかどうかが分からないので配置を外さず、その回の判定をやめる。買い物リストは今までどおり、商品一覧に無い商品に「現在は販売されていないため購入できません」と出す。次に庭を開いて照会に成功したときに外す。
- 商品一覧・配置の一覧・買い物リストに、照会結果（商品一覧は `GET /api/products` の `sellerStoreName`）から商品の店舗名を出す。
- 照会は画面から EC へ直接送る（商品一覧・買い物リストと同じ経路）。EC 向けの庭の買い物リスト API（`GET /api/gardens/{id}/shopping-list`、`shopping.py`）には店舗名を足さない。店舗名・買えるかは EC が自分の DB から求められるため。

Alternatives:

- Canvas のバックエンドで庭を読むたびに照会して外す案は採用しない。GET で庭を書き換えることになり、各操作から保存しない規約と、revision の比較による全体保存の流れから外れるため。
- 在庫0・非公開でも外す案は採用しない。入荷・再公開で買えるようになるため（#65 の不採用案）。
- 照会に失敗したら全部外す、または照会できない配置を外す案は採用しない。EC の障害で利用者の庭が消えるため。

Consequences: 外した配置は戻さない（店舗の再開・組織の再開後も、配置し直す必要がある）。照会は配置した商品が変わるたびに取り直すが、外すのは庭を開いたときの1回だけ（編集中に店舗が停止しても、次に開くまで残る）。自動保存が止まる状態（輪郭が未確定、範囲外の配置がある）では、外した結果はその状態が解消してから保存される。E2E は `e2e/unavailable-placements.spec.ts`（削除・在庫0・非公開・店舗停止・照会の遮断）。

### 検証用スクリプトの EC v3 への追従

EC v3 で `carts.store_id`・`cart_details`・`inventory.store_id`・`products.active` がなくなり、カートは会員ごとの1つになった。

- 直したもの：`backend/verification/deployment_preservation.py`（カートの増加の確認から `store_id` と `cart_details` を外した。`digest_database` は他のスクリプトから使われている）、`verify_database_tls.py`・`verify_linux_containers.py`（商品一覧を店舗1の指定なしで取る。店舗1が無い DB でも動く）。
- **EC v3 では使えないもの**（消さずに残す。2026-10 時点の特定のデータに対する1回限りの作業の記録で、package.json・E2E からは呼ばれていない。参考として残し、使う場合は作り直す）：
  - `backend/verification/retire_product_catalog.py`（prepare・apply・verify・repair-profiles。`products.active`、`carts.store_id`・`cart_details`、2026-10 時点の45商品を前提にする。`load`・`save` だけは他のスクリプトから使われていて、構成に依存しない）
  - `backend/verification/retire_legacy_oak.py`（`products.active` を比べる）
  - `backend/verification/verify_catalog_archive.py`（`inventory.store_id` と `products.active` で試験用の商品を作る）
  - `backend/verification/ai_product_test_data.py`（後片付けが、Cookie で作られる匿名のカートと `carts.store_id` を前提にする。v3 のカートは会員ごとで、`material_products`・`inventory` 以外の参照もある）
  - いずれも EC の `.env`（開発用 DB）を読むので、試験用 DB での実行にも向かない。
