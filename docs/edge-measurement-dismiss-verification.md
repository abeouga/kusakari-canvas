# 実寸入力の外側操作（2026-10-20）

## 仕様と影響

施工範囲の辺から開く実寸入力は、画面内のダイアログ外をクリック・タップすると閉じます。
未適用値は破棄し、適用済みの変更は保持します。背景の操作は遮断せず、別の辺への切替や
表示切替も一度の操作で実行します。外側操作では元の辺へフォーカスを戻しません。
「×」「取消」「Escape」のフォーカス復帰と、内部の入力・適用操作は維持します。

表示中だけDOMドキュメントのpointerdownをキャプチャ段階で監視し、終了時に解除します。
閉じる処理は表示状態だけを変更し、GardenDocument、dirty状態、API、DBを更新しません。
背景操作で発生する編集や適用済み変更の自動保存は既存どおりです。
公開API・DTO・スキーマ・依存関係の変更はありません。

## 検証方法

`npm run test:e2e -- edge-dismiss.spec.ts photo-scale.spec.ts photo-calibration.spec.ts`

既存のfull設定でCanvas・ECの実API/Webを専用ポートで起動します。
Canvasは専用MySQL `kusakari_canvas_e2e`、ECは `kusakari_e2e` を使用します。
正常系APIモック・代替DBは使いません。

新規E2Eは一意の名前の庭を実APIで作成し、削除せず証跡として残します。
開発者の庭・カート・注文は変更しません。既存の縮尺E2Eは従来どおり自身が作成した庭だけを削除します。

- デスクトップのクリックと、390×844のタッチ対応Chromiumの実タップを検証します。
- ダイアログ内部、写真余白、画面上部、別の辺、地面チェックボックスを操作します。
- 有効／不正な未適用値の破棄、明示的な閉鎖とフォーカス復帰を確認します。
- 自動保存の500ms待機時間を超えてPUTが発生せず、実APIの庭JSON・revisionが一致することを確認します。
- 適用直後に閉じてもPUTが成功し、再読み込み後に12.50mが復元されることを確認します。
- 再読み込み後の画面と、変更前・破棄後・適用後の実API JSONを成果物へ保存します。

## 実行結果

- Canvas: `check:js`、`lint`、`build:web`、`lint:api`、`compile:api` 成功。
- EC: `npm run check` 成功（checkJs、lint、フロントビルド、Javaビルド）。Javaビルドのユニットテストは既存設定によりスキップです。
- 既存の縮尺3件・校正2件のChromium E2Eは成功。
- 新規E2Eの初回はマウス成功、タッチはテスト用の辺がダイアログに隠れてタイムアウトしました。
  期待値や画面実装は変更せず、モバイル幅でも右辺が露出するテスト用輪郭に修正しました。
- `npm run test:e2e -- edge-dismiss.spec.ts` による修正後の再実行はマウス・タッチの2件とも成功（1.3分）。
  デスクトップとモバイルの再読み込み後スクリーンショットも目視確認しました。

Python検証の初回はuvの探索とサンドボックスのキャッシュ書込制限で停止しました。
既存のCanvasデータホームを指定し、承認された実行環境で再実行して通過しました。
Viteのチャンクサイズ、Three.jsのClock非推奨、FlywayのMySQL 8.4対応範囲について警告が出ています。

成果物はgitignore対象のローカルファイルです。

- 初回レポート・失敗trace・エラー詳細: `artifacts/e2e/edge-dismiss-first-run/report/` と同 `test-results/`
- 再実行レポート: `artifacts/e2e/full-suite/report/`
- 再実行の画面: `artifacts/e2e/full-suite/test-results/`
- 実API JSON: 再実行レポートの `garden-api-json` 添付、および `artifacts/e2e/full-suite/results.json` 内の同名添付
- 既存縮尺の画面・JSON: `artifacts/e2e/photo-scale-*.png`、`photo-scale-*.json`
- 既存校正の証跡: `artifacts/e2e/photo-calibration-current/`
