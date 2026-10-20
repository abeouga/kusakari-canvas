# 施工範囲内の配置基準点

## Context
新規配置の描画側だけが写真の輪郭を判定し、編集ドメインと保存APIは矩形だけを判定していた。

## Decision
基準点だけを施工範囲および土台矩形内に制限する。写真なしは矩形、写真ありは確定輪郭を地面座標へ投影する。辺・頂点を含み、許容誤差は1e-6 m。枝葉やモデルの端は判定しない。
APIは校正を再計算してから全配置を検証し、範囲外のPUTを400 OBJECT_POSITION_OUT_OF_BOUNDSで拒否する。GETは旧データを返す。スキーマ変更は不要。
ドラッグは最後の有効位置を維持する。旧データや輪郭変更で範囲外になった配置は利用者が移動・削除し、全件解消まで保存を止める。自動補正しない。

## Alternatives
矩形のみの判定では凹形状の外へ配置できる。モデル全体の包含判定は今回の基準点仕様と異なる。自動補正は意図した配置を変更するため採用しない。

## Consequences
既存の範囲外配置は開けるが、修正前の更新はできない。ECの価格・在庫・カート・注文と商品候補契約は変更しない。

## Verification
Chromiumと実API/MySQLを使用する。矩形・凹形状・投影・境界と直外、操作と保存復元を検証する。API直接PUTでUIを迂回した不正保存とrevision・DB不変を確認する。
旧データだけは専用E2E DBの新規テスト庭を限定更新して再現する。新APIは不正な保存を拒否するため、この状態を画面だけでは作れない。開発データ・他テストの庭は変更しない。

既存の写真移動テストは矩形端への強制補正から「最後の有効位置を維持」へ変更する。校正テストの初期配置は縮小後の8×6.4mにも収まる(-3.5, -3)mへ変更し、校正・高さ投影の検証目的を保つ。縮小による範囲外配置は専用テストで保存停止・修正を確認する。


## 2026-10-20 検証結果

- Canvas: `npm run check:js`、`npm run lint`、`npm run lint:api`、`npm run compile:api`、`npm run build:web` 成功。
- EC: `npm run check` 成功（checkJs、lint、フロント／Javaビルド）。ECのソース変更なし。
- Chromium E2Eは実Python API・実Java APIと、それぞれの専用MySQL `kusakari_canvas_e2e` / `kusakari_e2e` で実行。対象38ケースの最新実行結果はすべて成功。全E2Eを実行したという意味ではない。
- 初回回帰29件中、校正縮小後の範囲外seedを前提とする1件と、テスト庭の後処理DELETEでECONNRESETになった1件が失敗。前者は上記のfixture修正後に成功。後者は実装・期待値を変えず単独再実行で成功し、接続リセットの原因自体は未特定。初回のtrace・画面・レポートを保持。
- 不正PUT後のGETとDBのrevision・更新日時・配置の不変、旧配置の手動修正、輪郭縮小後の保存停止と削除後の再開を確認。成功時の再読み込み画面・庭JSON・旧配置修正後のDB値を保存。
- 既存のViteチャンクサイズ、Three.js非推奨、FlywayのMySQL対応版に関する警告は残る。

実行コマンド（リポジトリのPythonランナー設定を使用）：

```text
npm run test:e2e -- placement-bounds.spec.ts photo-interaction.spec.ts photo-boundary.spec.ts photo-calibration.spec.ts garden-dimensions.spec.ts polygon-edges.spec.ts photo-scale.spec.ts editor-autosave.spec.ts
npm run test:e2e -- placement-entrypoints.spec.ts --reporter=list,json --output=artifacts/e2e/placement-additional-traces
npm run test:e2e -- placement-bounds.spec.ts photo-calibration.spec.ts editor-transform-regression.spec.ts editor-toolbar.spec.ts product-browser-recovery.spec.ts --reporter=list,json --output=artifacts/e2e/placement-final-traces
npm run test:e2e -- photo-scale.spec.ts --grep calibrated --reporter=list,json --output=artifacts/e2e/placement-scale-recheck-traces
```

JSON reporterの出力先は各実行で `PLAYWRIGHT_JSON_OUTPUT_NAME` を分けた。集計は `artifacts/e2e/placement-bounds/verification-summary.json`、再読み込み画面・庭JSONは同ディレクトリに保存。初回の失敗証拠は `artifacts/e2e/full-suite/test-results/`、再検証結果は `artifacts/e2e/placement-final-results.json` と `artifacts/e2e/placement-scale-recheck-results.json`。
