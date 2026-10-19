# 評価用の指示切り替えと無課金確認

最新の進捗：[候補指示の最小実生成確認](ai-prompt-practical-review.md)を完了。利用者が位置精度を許容し、単体・重なりを各1回生成しました。目立つ拡大と植物保持の未確認箇所が残るため候補は通常利用へ適用せず、計2回で停止しています。厳密な測定を待つという従来の次段階は、この利用者判断により置き換わりました。

2026-10-16。実装と無課金検証を完了しました。現行`scene_layout_v1`と候補`scene_layout_v2`を評価用設定から選べます。単体・重なりとも設計時の全文ハッシュに一致しました。追加生成は0回です。測定精度の事前条件は未達であり、課金比較は開始できません。

## Context / Decision

[確定した設計](ai-prompt-revision-design.md)に沿い、`AiSettings.prompt_version`を指示版の正本としました。通常起動はv1です。候補本文を`ai_prompt_v2.py`へ置き、`ai_prompt.py`で本文・共通の画像役割・配置表を組み立てます。長い本文は読みやすい文字列へ分割し、送信される空白・改行とハッシュを維持しています。追加のクラス階層や依存ライブラリはありません。

評価時だけ`KUSAKARI_CANVAS_AI_EVAL_PROMPT_VERSION=scene_layout_v1|scene_layout_v2`を設定します。e2e、二重の実生成フラグ、証拠保存先、明示したquality、既存の計画ファイルを必須にし、v2でのマスク省略も拒否します。HTTP要求や画面に指示選択を追加していません。

実際の版を指示生成・証拠保存へ渡し、送信前に計画の版と全文ハッシュを照合します。版のない旧計画はv1だけ受け付けます。v2の版なし計画・異なる版・変更された全文は拒否します。古い履歴のスキーマ変更はありません。

`verification.run_ai_quality`には`--prompt-version`と`--measurement-report`を追加しました。旧v1の固定条件一致を先に検証し、候補は設計時に保存した`prompt-revision-design-01/design-manifest.json`と照合します。実装自身がその場で作った指示を期待値として使っていません。

明示的に指示版を選んだ実生成は両群mediumに限定し、測定報告のready・寸法準備・背景準備、対象ケース、Beforeと評価基準のハッシュを確認します。未達ならキー読み込み・サーバー起動・計画ファイル作成より前に停止します。これは測定記録の整合性確認であり、真の測定精度を自動証明する機能ではありません。版指定を使わない従来の品質評価経路はv1のままです。

無課金の準備例（プロジェクト直下）：

```powershell
$env:PYTHONPATH = 'C:/Users/t_abe/Desktop/kusakari-canvas/backend'
& backend/.venv/Scripts/python.exe -m verification.run_ai_quality --case single --quality medium --prompt-version scene_layout_v2 --run UNIQUE_DRY_RUN
```

`--live`を付けるには有効な測定報告が必要です。現在保存されている報告は`ready=false`のため、課金比較を開始しません。dry-runを含め既存run名の再利用は拒否します。

## 検証結果

- 独立検証：単体・重なりのv1/v2全文が凍結ハッシュに一致し、画像・マスク・モデル・寸法・配置表が両群で一致。
- 不正な版、通常環境での上書き、評価設定の欠落、v2のマスク省略、旧計画とv2の組み合わせ、指示全文・版の変更を拒否。証拠の実指示版・全文ハッシュも一致。
- 測定報告が未設定・未完了・異なる入力または基準を指す場合を拒否。実際の未完了報告を使った評価コマンドも開始前に拒否し、run計画・出力・provider証拠を作っていません。
- 実API・MySQL・Chromiumの画面テスト6件が成功。撮影と不正layout拒否、補助省略、撮影失敗後の復旧、medium/highの履歴保存・再表示、実画面から作った固定入力の一致を確認しました。
- 画面テストは候補v2を設定したサーバーを使い、キーを空にして実APIの503を確認しています。キー拒否は本文の組み立てより前なので、v2の生成成功やProviderへの実送信を証明したとは扱いません。本文・設定・送信前照合は独立検証で確認しています。正常API応答のモックはありません。
- 再読み込み後の画面と庭JSONを保存し、庭表示を目視確認しました。ECサイドバーは別の停止済み接続先を参照して取得エラーが出ています。AIの商品参考解決は専用EC API経由で成功しています。購入操作は評価対象外です。
- JavaScript lint、Python lint・compile、Webビルド、対象E2Eの型検査が成功。初回のPython lintはimport整形1件で失敗し、修正後に成功しました。
- 全体E2E型検査は別作業の`plant-model-product.spec.ts`にある既存4件で失敗（import拡張子1、undefinedの可能性2、priceYenの型1）。このファイルは変更していません。Webの大きなチャンク警告、Three.jsのClock非推奨警告が残っています。
- 開始・終了の全テーブルの行ID・全列の行ハッシュを比較し、Canvas開発DBとE2E DBは両方一致しました。
- ソースと成果物873ファイルを確認し、設定キーの混入なし、`.env`のGit除外、500行以上のソースなし。評価用EC APIとCanvas API/Webは停止済みで、既存の8086/5186は維持しました。

独立検証は、APIキー未設定の画面テストでは到達しない本文生成・送信前照合と、起動時の不正設定拒否を対象にしています。生成済みと偽った応答は使わず、証拠保存だけは明示したテスト画像で確認しました。

## 測定準備の結果

保存済みBefore、前回のmedium/high出力を、元の画素を維持した最近傍の拡大表示で確認しました。植物は3倍、固定背景点は8倍です。出力PNG自体に加工・位置合わせを加えていません。

左の枝`[139,274]`は、指定画素がぼやけた枝の境界にあり、同じ特徴の位置を必要な精度で特定できません。奥の柵`[1023,550]`は柵の細部と手前の葉が変化しており、同じ特徴の移動が4.265px以内と確定できません。植物も葉と草・影の境界から端点誤差±1pxを実証できませんでした。

したがって、`prompt-implementation-measurement-readiness.json`は`ready=false`、寸法・背景とも未完了です。任意の点を繰り返し選んでも精度の証明にならないため、繰り返し測定に成功したという記録は付けていません。前回の明らかな拡大という不合格は有効です。

## 証拠

- `artifacts/fastapi/prompt-implementation-checks.json`：全文・設定・版・証拠・測定報告の独立検証。
- `artifacts/fastapi/prompt-implementation-validation.json`：静的確認と画面テストの結果、追加生成0回。
- `artifacts/fastapi/prompt-implementation-db-before.json`、`prompt-implementation-db-final.json`：全行の保存確認。
- `artifacts/e2e/ai-quality/prompt-implementation-nokey-01-report/`：画面テスト6件成功。
- `artifacts/e2e/prompt-implementation-v2-*.json`とPNG：固定入力、履歴、再読み込み画面。
- `artifacts/e2e/ai-quality/prompt-implementation-*-dry-01-plan.json`：単体・重なりの候補が設計と一致した記録。
- `artifacts/e2e/ai-quality/prompt-measurement-landmarks.png`、`prompt-measurement-plants.png`：座標付きの確認画像。
- `artifacts/e2e/ai-quality/prompt-implementation-measurement-readiness.json`：未達理由と入力・評価基準のハッシュ。

以前の標準名の撮影成果物は`artifacts/prompt-implementation-previous-e2e/`へコピーしてから更新しました。凍結済みのAPI出力と設計テキストは上書きしていません。commit・pushは行っていません。

## Consequences / 次のフェーズ

実装と無課金検証は完了です。生成の開始条件は未達です。次はAstra / highを担当設定とする「測定点と判定手順の再検討」です。特定可能な特徴、読み取り誤差、許容値の関係を整理します。既存の点や基準を変更する場合は新しい評価計画として事前登録し、以前の不合格を遡って合格にしません。測定準備が完了した後に、現行／候補を各1回生成する段階へ進みます。

担当設定は役割の割り当てであり、このチャットの実行モデルが切り替わった証明ではありません。
