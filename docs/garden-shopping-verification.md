# 庭別買い物リストの検証結果

確認日：2026-10-16

## 結果

実API・専用MySQL・ChromiumによるE2Eは合計25件成功。失敗・スキップ・不安定な再試行は0件。

| 実行 | 成功件数 | 結果ファイル |
| --- | ---: | --- |
| Canvas `npm run test:shopping` | 9 | [新機能・植物モデル](../artifacts/e2e/shopping-lists/results.json) |
| EC `npm run test:shopping-regression` | 13 | `kusakari-ec/artifacts/e2e/shopping-regression-results.json` |
| EC `npx playwright test --config playwright.integration.config.js` | 3 | `kusakari-ec/artifacts/e2e/shopping-integration-results.json` |

所有者分離は実FastAPI・専用MySQLで別途4項目を確認した。[結果](../artifacts/e2e/shopping-lists/owner-isolation.json)

## 確認した動作

- 庭A・庭Bのリストが独立し、配置操作はECカートを変更しない。
- 商品一覧・リストからの配置、自動保存、開いたEC画面への数量反映、再読み込み後の一致。
- 個別選択・全選択・選択解除と、既存カート数量への加算。
- 在庫不足・販売終了・99点上限・50種類上限の見送りと、成功分だけの追加。
- 同時に送った同一revisionの追加は1件だけ成功し、もう1件は409で二重加算されない。
- 古い庭revision、対応しない商品選択、数量のクライアント指定は拒否される。
- 保存失敗からの再試行、保存競合時の編集内容保持、自動上書きの停止。
- EC通信障害中もCanvasのリスト・配置・保存が動作する。
- 旧配置の購入候補が複数ある場合、購入商品とチェックの両方を明示的に選ぶ。
- 一部商品の追加結果・見送り理由と、モバイル画面での表示。
- 各植物タイプ2パターンの出品、プレビュー、配置、写真上での配置、構成の保存復元。
- 既存ECの商品CRUD、カート、注文、配送情報、画面モック・既存の材料照合。

## 画面

- [Canvasの庭別リスト](../artifacts/e2e/shopping-lists/canvas-list-a.png)
- [ECカートと庭別一覧](../artifacts/e2e/shopping-lists/ec-cart-and-gardens.png)
- [一部商品の追加結果](../artifacts/e2e/shopping-lists/ec-partial-result.png)
- [モバイルの買い物リスト](../artifacts/e2e/shopping-lists/mobile-shopping-list.png)
- [保存競合時の編集保持](../artifacts/e2e/shopping-lists/conflict-preserves-edit.png)

## 静的確認・通常起動

両フロントのlintとビルド、ECのcheckJs、Pythonのlintとコンパイル、Javaビルドは成功した。Javaビルドはテストをスキップする既存コマンドを使い、動作検証は上記の実API E2Eで行った。

EC（5186 / 8086）とCanvas（5173 / 8080）の通常起動とHTTP 200を確認した。起動前後の既存業務データの行数・ハッシュは一致した。今回の機能のためのDBスキーマ変更はない。

最初のEC回帰実行は、外部フォントの完了待ちで1件が時間超過した。任意の外部フォントを必須の待機条件から外し、ローカル商品画像の読み込み・画面幅・キーボード操作の検証を維持して再実行し、13件すべて成功した。

有料AI画像生成の実行は、この買い物リスト変更の検証には含めていない。
