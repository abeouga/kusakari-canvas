# サムネイル送信容量（2026-10-19）

## Context
Canvasの編集画面は庭サムネイルを表示しないが、ECの `/cart#garden-shopping-lists` は
ShoppingListOverview → EC thumbnail API → Canvas thumbnail API経由で表示する。
保存処理は未使用ではない。PNGを640×400へ縮小するだけでは詳細な写真で460,000バイトの
リクエスト上限を超え、413となる。失敗は画面へ通知せず最大3回試行していた。

## Decision
保存機能とAPI制限を維持し、PNGのData URLが400,000文字以内になるまで縦横を80%ずつ縮小する。
PNG本体330,000バイト、Data URL 450,000文字、JSON 460,000バイトの各制限に余裕を残す。
庭の写真原本・配置・revisionは変更しない。

## Alternatives
- 保存処理の削除：ECで現行配置のキャプチャを表示できなくなるため採用しない。
- API上限の引き上げ：小さな一覧画像に大容量の送信・保存を許す必要がないため採用しない。

## Consequences
容量が大きい写真では一覧画像の解像度が下がる。容量内の画像は従来の寸法を維持する。
Chromium E2E `thumbnail-budget.spec.ts` で高密度の合成写真を専用MySQLへ保存し、旧相当の
ペイロードが実APIで413になること、編集画面からの新しい送信が204になること、再読込後の
GETがscene画像を返すこと、庭JSONが変化しないことを確認する。APIモックは使わない。
証跡は `artifacts/e2e/thumbnail-budget` に保存し、独立した庭を残す。

## Validation
2026-10-19、Chromium・実API・専用MySQLのE2Eで1件成功。
元のData URLは1,175,334文字でPOSTは413。修正後の画面送信は302,773バイト、
初回と再読み込み後の両方で204。取得元はscene、庭JSONは一致した。
フロントlint、追加モジュールのcheckJs、フロントビルド、Python lint/compileも成功。
EC画面の表示経路はコード参照で確認し、このE2EではCanvasの保存・取得を検証した。
