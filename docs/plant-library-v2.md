# 植物部品ライブラリ第2版

## Context

植物の特徴から多数の外形を作り、対応商品をローカルECへ出品する依頼。24部品は初期制作目標であり、全植物を網羅できるという検証済みの数値ではない。

## Decision

- `scripts/generate-plant-parts-v2.mjs` で事前制作した24個のGLBを `frontend/public/models/plant-parts/v2/` に保存する。実行時に形状は生成しない。
- 木質幹・草本茎・節のある幹・ヤシ幹の4部品、基本葉10部品、花序7部品、つる茎・曲がる茎・羽状葉の3部品。旧6部品はv1のまま保持する。
- 構成規則は樹木・針葉樹・株立ち・低木・横広がり低木・草花・グラス・ロゼット・つる・ヤシの10系統。前案の9系統にヤシを独立追加した。
- 新規商品の構成は `version:2 / catalogVersion:2`。庭の保存検証では保存された版で再計算する。第1版の形状と保存互換性を保持する。
- 針葉樹・グラス・ヤシ・ロゼット・つるは対応する葉形を制限する。植物学的にすべての組合せが正しいことを保証するものではない。
- 実GLBのローカル境界を記録し、部品変換後の境界から指定寸法へ調整する。材質ごとにオフラインでメッシュを結合し、花弁単位の描画呼び出しを抑える。
- 30構成を `scripts/plant-library-presets.mjs` に定義する。外形に基づく商品名を使用し、未確認の品種・産地・認証・栽培特性を記載しない。価格と在庫はローカル用の設定値。
- `scripts/publish-plant-library.mjs` は検証済み画像を商品画像として保存し、通常の商品APIを通じて店舗1へ登録する。同一SKUの再実行は内容照合して再利用し、既存商品の更新・削除はしない。

## Alternatives

完成植物GLBを30個作る方式は部品再利用にならないため採用しない。第1版GLBの上書きは既存庭の外観を変えるため採用しない。

## Consequences

30商品は30種の植物学的復元を意味しない。配色・寸法違いを含む。全品種の網羅率、第三者による識別率、実物写真との一致は未評価。

## Verification

主検証は `playwright.plant-library.config.ts` による実API・専用MySQL・Chromium。24ファイルのGLB配信、30商品の作成とプレビュー、旧v1との混在、ドラッグ配置、保存再読込、構成改ざん拒否、商品照合を確認する。30個表示時のrequestAnimationFrame頻度は参考値であり、GPU描画FPSと同一ではない。

幾何境界の独立検証は、見た目だけでは接続基点や不正な頂点を網羅できないため、GLBのPOSITION属性・索引・境界・接続点を検査する。

### 2026-10-17の検証結果

- 独立したGLB読み取り検査で24部品の実頂点、有限値、境界寸法、接続点を確認。合計1,036,980バイト。
- 初回の30構成の実API/MySQL E2Eが成功。旧版2個と追加ドラッグ1個を含む33個を表示・保存・再読み込みした。画面例外0件。requestAnimationFrame測定は約49.7回/秒（GPU描画FPSや他端末の性能保証ではない）。
- 通常ローカルECの店舗1へ30商品をAPI登録し、全30商品と画像の表示・ブラウザ再読み込みを確認。登録前15商品、登録後45商品。登録前の商品API内容は全件一致。
- 価格は1,500〜9,800円、各在庫20の初期設定値。商品名と説明に「モック」は付けていない。品種名、学名、生産者、産地、栽培条件の未確認情報は追加していない。
- 30構成の一覧画像を目視確認した。樹木・草花・グラス・ロゼット・つる・ヤシの外形差を確認。配色・寸法違いも含まれるため30植物種の識別保証ではない。
- 初回の長時間実行では検証Webサーバーが途中停止し、別実行では起動待ちが時間切れになった。起動成功後の検証と区別し、`artifacts/plant-library-*-run*.log` に記録する。
- 出品フォーム試験の初回はHTTP422という試験側の想定が既存API契約と不一致だった。Canvasの既存RequestValidationErrorハンドラーはHTTP400であるため、契約に沿って400と拒否内容を確認する。

最終回帰は4件すべて成功（2.9分、失敗・スキップ・再試行0件）。新しい出品フォーム、不正組合せの拒否、30構成と旧版の混在、従来6構成の出品・買い物リストからのドラッグ・編集・写真表示・保存復元、商品照合、旧クライアントの在庫編集を確認した。最終の33個表示時のrequestAnimationFrame測定は約56.3回/秒。

CanvasとECのlint・フロントビルド、ECのJavaScript型確認・Javaビルド、CanvasのPython静的確認・コンパイル、変更対象E2EのTypeScript確認は成功した。Canvasのフロントビルドには既存の大きいバンドル警告が残る。

証拠：`artifacts/e2e/plant-library-v2/`、`artifacts/plant-library-publication/`、`artifacts/plant-library-final-run.log`。AI画像生成に対する新しい植物タイプの適合性は本検証の対象外。
# 2026-10-17 v3 correctness revision

Context: the v2 audit found false grounding, dimensions inferred from rotated boxes, inert controls,
and botanical mismatches. Product thumbnails are not botanical ground truth.

Decision: preserve the v1/v2 generators and GLBs for saved manifests; introduce v3 assets/manifests.
Fit the branching scaffold against convex support hulls of the actual GLB vertices. Keep leaf and
flower scales uniform, keep root Y=0, and report measured depth instead of forcing width=depth.
Width means the maximum horizontal crown span. Reject infeasible dimensions rather than distort leaves.
Species-specific forms initially cover Acer palmatum, Monstera deliciosa, Iberis sempervirens,
Hakonechloa macra, and Cupressus macrocarpa Goldcrest. Preserve generic combinations for other products.

Alternatives: overwriting v2 breaks saved canonical manifests; stretching whole models changes the
meaning of leaf and trunk measurements. Neither is adopted.

Consequences: EC profile accepts an optional botanicalForm. Old manifests remain readable/saveable.
Only the current user-approved garden is migrated, with a backup and preserved object transforms.
Normal EC price, stock, photos, IDs, unrelated products and other gardens must remain unchanged.

Independent verification is necessary because successful browser rendering cannot detect floating roots,
wrong mesh dimensions, inert parameters, or lost leaf holes. Measure raw GLB vertices independently of
the server hull fitter; check ground error <=1mm and height/max-width error <=0.5%, uniform leaf scales,
parameter sensitivity and deterministic results. E2E uses real APIs and dedicated MySQL databases,
saves/reloads a garden and compares its JSON; also verifies old versions without recreating their data.
Visual review compares multiple viewing angles against primary botanical photos and descriptions:
https://plants.ces.ncsu.edu/plants/acer-palmatum/
https://hort.extension.wisc.edu/articles/monstera-deliciosa/
https://plantdatabase.kpu.ca/Plant/ibse
https://hort.extension.wisc.edu/articles/japanese-forest-grass-hakonechloa-macra/
https://plants.ces.ncsu.edu/plants/hesperocyparis-macrocarpa-goldcrest/
https://www.rhs.org.uk/plants/544537/hesperocyparis-macrocarpa-goldcrest/details

## v3 検証・反映結果（2026-10-17）

### 修正と判定範囲

- 根元をY=0に固定し、GLBの実頂点から接地・寸法を求める。葉や花の縦横比を変える全体伸縮を廃止した。
- 幅の契約はモデルの基準方向のX/Z外接幅のうち大きい方。奥行きは実測値を保持する。全方位から見た最大直径や成長後の寸法を表すものではない。
- 葉の大きさ・密度をグラス、ロゼット、ヤシにも反映。形態に適用できない樹冠形、太さ、枝角度はフォームに表示しない。成立しない寸法の組合せは明示的に拒否する。
- v1/v2の部品・生成規則は上書きせず、保存された版で検証する。v3の寸法は小数8桁に統一し、MySQL JSONの再シリアライズによる最終桁の違いで正しい保存を拒否しないようにした。構成の厳密比較は維持する。
- 同一プロファイルのv3結果を最大128件まで再利用する。呼び出し元には深いコピーを返し、構成の変更が検証基準に混入しないようにした。
- ECの新しい植物別設定は省略可能。設定を送らない旧クライアントの在庫編集は旧構成を保持する。植物設定を明示して保存する場合は旧構成をv3へ更新する。
- 大きい構成JSONを含む一覧でMySQLの並べ替えメモリ不足を再現した。Java側で既に確定している表示順を維持し、重複するSQLの並べ替えのみ除去した。

### 代表5種類の形状レビュー

一次資料の写真を表示し、モデルの正面・側面を確認した。参考写真は商品の画像へ転用していない。

| 対象 | 今回の改善 | 残る制約 |
| --- | --- | --- |
| イロハモミジ | 連続した7裂の単葉、対生の葉、小枝と葉柄 | 枝間隔や主幹が規則的で、自然な樹形・樹皮は未再現 |
| モンステラ | 丸みのある葉の切れ込み、実際に抜けた6個の穴、節と曲がる葉柄 | 同じ葉形の反復、若葉・気根・光沢の再現は不足 |
| イベリス | 小さい細葉、4花弁の小花を束ねた花房、低く広がる枝 | 写真より葉群のまとまりと花房の自然な不均一さが不足 |
| フウチソウ | 弓状の葉、細い稈、節ごとの葉、葉サイズと密度の反映 | 稈が露出しやすく、一方向へ流れる株姿は不十分 |
| ゴールドクレスト | 長い針葉から鱗片葉の小枝へ変更、主幹先端の先細り、枝角度の変化 | 下部に枝の段差や幹が見え、実物より疎な箇所が残る |

この5種類は特徴の改善を行った近似モデルであり、実写相当・特定個体の復元・第三者による識別合格を意味しない。他の25商品は主に接地・寸法・設定の修正であり、種固有形態の精密化は対象外。

### 確認できた結果

- 30構成を生成側とは独立に実GLB頂点で測定。接地誤差の最大値0m、高さ誤差の最大値0.094%、幅誤差の最大値0.116%。許容値は接地1mm、寸法0.5%。
- 81組の設定変更で形状変化と寸法維持を確認。異なる任意値の全組合せを保証するものではない。不可能寸法の拒否、同一条件の再現性、旧版10構成の互換性を確認。
- モンステラの6個の穴は実三角形へのレイ交差が0、周囲の葉面は交差あり。単なる模様ではない。
- 実API・専用MySQL・Chromiumの関連6件が成功（約3分、失敗・スキップ・再試行0）。30商品＋旧版2個＋ドラッグ追加1個の33個表示、出品プレビュー、配置・回転・倍率変更、保存再読込、購入照合、不正な構成の拒否を含む。
- 33個表示時のrequestAnimationFrame頻度は約54.9回/秒。これはGPU描画FPSや他の端末の性能保証ではない。
- Canvasのlint・Python静的確認/コンパイル・フロントビルド・対象E2E型確認、ECの型確認・lint・フロント/Javaビルドが成功。Canvasには既存の大きいバンドル警告が残る。リポジトリ全E2Eを実施したという意味ではない。
- 対象30商品の構成をv3へ更新。3店舗すべてで商品名・写真・価格・在庫などの非モデル項目を照合し、変更なしを確認。対象外15商品、他の庭も変更なし。
- ユーザー承認済みの現在の庭は反映時点で11株。revision 15→16へ更新し、11株のID・位置・回転・倍率・商品関連付けを維持した。再読込後11/11表示、画面例外0、検査による庭データ変更なしを確認。

検証スクリプトは `verify-plant-v3.mjs`、`verify-plant-v3-settings.mjs`、`verify-plant-v3-leaf-holes.mjs`、`playwright.plant-v3.config.ts`。
測定・画面・参考資料・テスト結果は `artifacts/plant-v3/`。更新直前の全店舗商品と庭のバックアップは `artifacts/plant-v3/publication/2026-10-17T14-39-36.192Z/`。
これらのローカル実データ・写真・検証成果物はgitignore対象で、公開成果物には含めない。
移行用スクリプトは `node scripts/publish-plant-v3.mjs --garden=<承認済み庭UUID>` で事前測定のみ、`--apply` を追加した場合に限り更新する。

## 2026-10-18 カタログ整理

### Context / Decision

ユーザー指定により、直近追加した30商品（v3が25、v4が5）と、旧固定GLBの「木」
（`tree_oak` / 対応商品 `canvas-oak`）だけを販売・新規選択の一覧に残した。
旧14商品は既存EC APIで `active=false` にし、全3店舗で45件から31件になった。
名前・価格・在庫・画像・残す商品の構成は変更していない。

### Alternatives / Consequences

旧商品にはカート3行、注文1行、庭の配置8件から参照がある。旧固定GLBも既存の庭に使われている。
そのため商品行・素材レコード・GLB・保存済み構成を物理削除せず、互換表示と履歴を維持する。
既存の庭から植物を消す処理や、新商品への自動置換は行わない。
旧商品はEC/Canvasの商品一覧と購入照合候補から外れるが、保存済みの配置や買い物リストには残る。
旧商品を含むカートは従来の販売終了判定の対象になる。

### Verification

- `backend/verification/retire_product_catalog.py` は事前退避・変更競合検出・明示した14 IDのみの適用を行う。
  実行先は通常ローカルDBに限定し、成果物は `D:\KusakariVerification\catalog-cleanup-20261018` に保存した。
- 初回適用で既存ECの全列更新による旧プロフィール7件への `botanicalForm:null` 追加を検出した。
  当該7列だけを退避データから復元し、販売状態以外の全商品列が完全一致することを確認した。
  ECの削除処理は販売状態だけを更新する方式に修正した。初回失敗と復元結果は別ファイルで残した。
- 全DBテーブルの照合で、通常データの変更は予定した14件の販売状態だけ。
  庭・配置・カート・注文・在庫・画像・材料関連付けを維持し、木GLBのSHA-256も一致した。
- 専用MySQL `kusakari_e2e` と実EC APIの削除回帰8項目が成功。
  旧JSONの不変、繰り返し削除、一覧・購入候補からの除外、存在しないIDの404を確認。
  検証用1商品のみを後片付けし、既存E2Eデータの全テーブルハッシュが前後一致した。
- ChromiumでEC/Canvasを再読み込みし、両方31商品、ECの31画像読み込み、木と新商品の選択、
  現在の庭11/11株の描画、庭JSON不変、画面例外0件を確認。画面画像も目視確認した。
  通常データの検査は読み取り専用で、サムネイル自動書込みを遮断し、既存の空カートを参照して新規作成を避けた。
  初回の選択取消試験はサイドバーにフォーカスがあるため失敗。キャンバス側へフォーカスを戻す操作で再検証した。
- Javaビルド、変更したPython/JavaScript検証スクリプトのlintが成功。

この整理は現在のローカルカタログへの明示的操作であり、起動時の一括削除や既存マイグレーションの改変は行わない。

### 追記：旧「木」の例外撤回（2026-10-18）

利用者が「木」も削除可と変更したため、`canvas-oak` 1件を追加で販売停止した。
EC/Canvasの新規一覧は新しい30商品のみ。既存庭の参照整合性のためアセットとGLBは残す。
`backend/verification/retire_legacy_oak.py` が事前退避、対象ID・SKUの照合、全テーブル比較を行う。
前回の31件という検証結果は履歴として保持し、今回の退避・検証資料は
`D:\KusakariVerification\ai-products-20261019` に分離した。画像生成側の変更は
[配置商品の自動参照](ai-image-generation.md)を参照する。

