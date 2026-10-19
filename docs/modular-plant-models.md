# 商品特徴から事前制作GLB部品を構成する

第2版の24部品・10構成規則・30商品の追加仕様は [plant-library-v2.md](plant-library-v2.md) を参照。以下は保存互換性を維持する第1版の設計記録です。

## Context

対象は kusakari-ec / kusakari-canvas。ECの商品に園芸情報はあるが、植物の部品構成と商品を結び付けるデータがなかった。完成した植物モデルを選択する方式ではなく、植物特徴から共通GLB部品を組み合わせる。

## Decision

- `frontend/public/models/plant-parts/v1/` のGLBは事前制作済み部品。`scripts/generate-plant-parts.mjs` は開発者用のオフライン制作ツールで、アプリから実行しない。
- カタログJSONとGLBに `attachment-base` / `attachment-tip` を定義する。単位m、+Yが上。茎は根元(0,0,0)、先端(0,1,0)。枝の根元を親の接続位置に合わせ、葉の葉柄と花の根元も同じ接続点に合わせる。
- 樹木・低木・草花はそれぞれ異なる配置規則を持つ。同じ特徴とseedから同じ部品ID・位置・四元数・倍率・色を返す。メッシュや完成GLBを実行時に生成しない。
- Canvas `GET /api/model-parts` は部品カタログ、`POST /api/model-assemblies/resolve` は特徴から構成マニフェストを返す。出品フォームのプレビューとECの商品保存は同じ解決処理を使う。
- ECは `plantModelProfile` とサーバーが確定した `modelComposition` を商品に保存する。ECからCanvas APIへは `KUSAKARI_CANVAS_API_URL` で接続する。構成解決に失敗した場合、モデル設定付きの商品保存は失敗し、商品更新をロールバックする。
- 高さは既存商品 `heightCm` を再利用し、構成プロフィールと一致することをサーバーで検証する。
- 指定高さと幅に合う外形の調整倍率 `fitScale` も保存する。全体に同じ変換をかけ、部品の接続を維持する。
- 庭の新しい植物は既存のアセット外部キーを維持するため予約アセット `plant_modular` を使い、商品ID・商品名・材料コード・構成JSONを配置に保存する。読み込み時は保存された部品構成を描画する。商品更新後も既存の庭は以前の構成を保持する。
- 製品ごとに `product.<productId>` の材料コードをECで関連付ける。既存の `materialCode / quantity / unit` による候補照合と同じECカートを使う。ドラッグ配置だけではカート数量は変えない。
- 既存固定GLBの配置は変更しない。追加フィールドのない旧庭JSONも保存・復元できる。
- カタログ版1と構成規則版1は保存済みデータの契約。将来ルールや部品を変更するときは版とファイルURLを追加し、旧版を残す。

## Alternatives

完成GLB選択は出品者が植物特徴だけを提供する要件を満たさない。Canvas表示時に特徴から毎回計算する方式は、後日のルール変更で保存済み庭の形が変わるため採用しない。

## Consequences

出品時にECとCanvas APIの双方が必要。表示時は事前制作GLBを保存済み変換でインスタンス描画する。初期部品は茎、楕円葉、細葉、針葉、5弁花、8弁花の6種類で、個別植物の正確な植物学的復元ではない。特殊形態を追加するときは部品と構成規則を追加する。

## Verification

ECのAPIをビルドした後、Canvasで `npm run test:shopping` を実行する。両リポジトリは同じ親フォルダに置く。専用MySQLのEC `kusakari_e2e` / Canvas `kusakari_canvas_e2e` を使い、販売者の入力・6構成のプレビュー・商品保存・商品一覧と庭の買い物リストからのドラッグ・自動保存・再読込・商品編集後の旧構成保持・幅変更・EC側の選択購入を確認する。画面と実API JSONは `artifacts/e2e/plant-model/` に保存する。
