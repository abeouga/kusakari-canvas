# 検証成果物のGit管理

## Context

`artifacts/` に実行結果と検証用ソースが混在し、340ファイルが追跡されていた。生成物の更新・未追跡表示で実装差分が見づらくなっていた。

## Decision

- 生成した画面画像、実API JSON、計測結果、HTMLレポート、trace、失敗記録は `.gitignore` で除外する。既存の323ファイルはインデックスからだけ外し、作業フォルダのファイルは削除しない。
- `artifacts/e2e/` の既存検証用 `.mjs` 15本、`artifacts/models/render-oak.py`、旧モデルの比較資料 `artifacts/models/tree-oak-before.glb` は明示的な例外として追跡を維持する。旧GLBを現在のE2Eの必須fixtureとは扱わない。
- 固定入力の `e2e/fixtures/ai-quality/`（写真・出典・説明）と `e2e/fixtures/plant-composition-v1.json` は追跡を維持する。今後の再利用するfixture・比較基準も `e2e/fixtures/` に置く。新しい検証スクリプトは `scripts/` または `backend/verification/` に置く。
- 検証結果の要約と手順は `docs/` で追跡する。実行証跡をレビュー担当者と共有する場合は、秘密情報・実利用者データを確認してから別途共有する。CIへの自動保管は今回追加していない。

## 参照の確認

- 全E2Eの画像正規化入力は `e2e/full-setup.ts` が `verification.verify_ai_frame` から実行時に生成する。
- `ai-quality-settings.spec.ts` の固定入力比較は同じ実行で保存した入力を基準にする。有料AI比較の `KUSAKARI_CANVAS_AI_QUALITY_BASELINE` は明示した過去実行の成果物を必要とするため、そのディレクトリをローカル保管または別途取得する。過去の実行結果を固定fixtureとして一括登録しない。
- 旧oak検証の `blender-demo-garden.json` は `artifacts/e2e/preview-oak.mjs` が生成する実行間の中間結果。後続スクリプトは同じ環境で生成した結果を使う。
- `scripts/review-plant-library.mjs` / `publish-plant-library.mjs` が読む画像・商品・計測値は、植物ライブラリ検証の実行結果。新しい環境では先に該当検証を実行する。
- `scripts/verify-plant-v4.mjs` が読むv3のcompositions/measurementsは `scripts/verify-plant-v3.mjs` の生成物で、従来から追跡対象外。v3/v4の旧検証が参照する `plant-combination-audit/garden-before.json` も元から未追跡で、今回その依存や内容は変更しない。
- `tree-oak-preview.png` はBlenderのレンダリング出力。再生成・アイコン作成の手順は `docs/assets.md` にある。

## Alternatives

`artifacts/` を例外なしで追跡解除すると検証用ソースと旧モデルも失われるため、既存の17ファイルは例外を列挙して残す。拡張子単位で全JSON・全画像を残す方法は生成物まで追跡するため採用しない。

## Consequences / 検証

Git上では生成物の削除差分になるが、この作業環境のファイルは残る。既存履歴は書き換えない。別のクローンでこのコミットを取り込む場合、追跡解除された成果物はGit上の削除として反映されるため、必要な過去証跡は取り込み前に別途保管する。

今回の変更は追跡設定と文書のみ。追跡済み340ファイルのSHA-256を変更前後で照合し、ファイルの残存と内容不変、固定fixtureの追跡継続、生成物のignore適用、`git diff --cached --check` を確認する。アプリ・テストのソース変更がないため、E2E・ビルドは再実行しない。
