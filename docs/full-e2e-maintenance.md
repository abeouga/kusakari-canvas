# 全E2Eの実行環境と現行UIへの更新

## Context

Canvas単独の標準設定ではECを起動せず、ECを必要とするテストにも適用されていた。専用設定には旧リポジトリ名、固定ポート、機械固有のDドライブが残っていた。さらに旧デモ商品、旧AI商品選択フォーム、画像出力の旧導線、未追跡の過去成果物に依存するケースがあった。

`asset-*`ボタンは現行ProductBrowserにも存在する。商品が取得できない場合や廃止済みデモ商品では表示されないため、ボタンそのものの廃止とは区別する。

## Decision

- 全体検証は`npm run test:e2e -- --config playwright.full.config.ts`で実行する。
- Canvas API/Web、EC API/Webに4つの空きポートを割り当てる。MySQLはCanvasの`kusakari_canvas_e2e`とECの`kusakari_e2e`を使用する。既存開発プロセスの停止・再利用はしない。
- JavaのWindowsソケット用一時ディレクトリをテスト出力配下に限定する。通常の`java.io.tmpdir`より`TEMP`が優先されるため、`jdk.net.unixdomain.tmpdir`を設定する。[OpenJDK実装](https://raw.githubusercontent.com/openjdk/jdk21u/master/src/java.base/windows/classes/sun/nio/ch/UnixDomainSocketsUtil.java)
- 有料AI生成とDB障害注入は既存の明示実行条件を維持する。通常検証では生成キーを空にし、実APIでの未設定応答を確認する。正常系APIモックは追加しない。
- 商品配置には実EC APIで新規作成した商品を使う。廃止済み商品を再有効化しない。旧固定モデルの読み込み・回転・GLB失敗回復には、実Canvas APIで独立した保存済み庭を用意する。
- 過去のテストデータを名前で検索して削除する処理は除去する。
- 画像正規化fixtureは既存Python検証から毎回生成し、機械固有の過去成果物を要求しない。固定入力比較も今回の実ブラウザ送信を保存してから再送と比較し、変更入力の拒否を確認する。

## Alternatives

- 正常系APIのモックや廃止済みデモ商品への依存は、実API/MySQLの検証にならないため採用しない。
- スクリーンショットの差分許容を増やしてフォーカス枠の差を吸収する方法は採用しない。重なるHTMLも撮影されるため、前後のフォーカスを同じチェックボックスにそろえる。

## Consequences

テスト用商品・庭は各ケースで独立作成する。既存データの全消去は行わない。画像出力前後の画素比較、正常系の保存・復元、失敗時の編集保持と再試行を維持する。実行結果は`artifacts/e2e/full-suite/`に保存する。

## 検証記録

- 初回診断: 87件を検出。8件失敗時点で停止し、6件成功、13件スキップ、60件未実行。`first-failures/`と`first-failures-report/`に保存。
- 画像関連の追加診断: 商品fixtureの旧DTO項目、旧導線、フォーカス枠の画素差を確認。修正後の全件実行で再検証する。
- 全件診断で、草花の`plant_modular`がcoverageの植物判定から漏れ、非植物の緑として描画される実不具合を確認した。旧tree/shrubだけの判定が原因。実商品の草モデルと家具を同時撮影するE2Eで赤・緑の画素と投影範囲を検証する。
- `image-studio.md`の承認済み仕様では植物別の遮蔽解析は廃止済み。旧`raster`期待値は、`projected_box`・可視状態未推定・投影範囲への実植物画素の包含検証に置き換える。
- 参考写真のアップロードは画像デコード完了の表示を待ってから生成する。自動保存の確認用GETは切断されたアイドル接続だけ1回再試行し、HTTPエラーや保存内容の検査を省略しない。
- 全件診断: **69件成功・16件失敗・有料専用2件スキップ（22.0分）**。`full-diagnostic-results.json`、`full-diagnostic-report/`、`full-diagnostic-failures/`に保存。
- 写真右下の輪郭入力が、無効なAI生成ボタンに遮られて頂点を失う不具合も再現した。輪郭描画中だけメニューを隠し、写真端の4点の保存・再読み込みを再検証する。
- 出品E2Eは現在の3段階フォーム、商品画像アップロード、モデル詳細、密度スライダー、確認・出品に更新。商品API入力からレスポンス専用の`publicationStatus`を除外する。通常編集の離脱は保存完了を確認し、未保存確認は未確定の写真輪郭で検証する。
- 失敗ケースの修正後再実行: **16件成功・失敗0件（5.3分）**。`repair-results.json`と`repair-report/`に保存。
- 最終全件実行で、商品画像のPython検証が前回の成果物と同名ファイルを新規作成して失敗した。画像検証そのものではなく証跡保存の衝突であり、庭IDごとの`pipeline-<gardenId>/`へ分離した。以前の証跡を削除せず、繰り返し実行できることを対象再実行で確認する。
- 最終全件実行: **84件成功・成果物保存先の衝突1件失敗・有料専用2件スキップ（22.3分）**。`final-full-results.json`、`final-full-report/`、`final-full-test-results/`と`final-run.log`に保存。
- 保存先修正後、同じ対象を`--repeat-each=2`で実行し、**2回とも成功（1.6分）**。`final-repeat-results.json`、`report/`と`final-repeat-run.log`に保存。通常85件はすべて成功を確認済みだが、全件実行1回だけの成功ではなく、対象再実行を含む結果である。ケース別の対応表は`verification-summary.json`。
- checkJs（全フロント）、変更E2Eと全体設定のTypeScript検査、lint、フロントビルド、Python APIのlint/compile、EC Javaビルドが成功。既存の大きなフロント配信ファイルの警告は残る。公開API・DBスキーマ・依存・ロックファイルに変更なし。
- 成功時の再読み込み画面と実API JSONを保存。追跡済み成果物70ファイルは今回の内容を`generated-evidence/`にコピーしてから元に戻した。既存未追跡成果物を保持し、ECソース・既存データ・開発プロセスは変更していない。
- 有料OpenAI生成とDB障害注入の2件は既存の明示実行条件によりスキップし、品質評価・有料経路の成功は主張しない。通常検証のOpenAI呼び出しは0回。
