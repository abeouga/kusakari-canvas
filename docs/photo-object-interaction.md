# 写真・3Dの配置操作（2026-10-19）

## Context

- 写真表示には選択処理だけがあり、移動ハンドルがなかった。
- 保存成功時のQuery更新でEditorPageの初期表示処理が繰り返され、写真付きの庭は3D表示から写真表示へ戻っていた。
- 大きな低木（倍率3）の選択枠に近い小さな低木（X=2.1、倍率0.7）をクリックしても選択できないケースを実API・MySQL・Chromiumで再現した。選択枠のLineSegmentsが入力を受け、親のstopPropagationで別モデルへの入力が止まる。選択枠だけをraycast対象外にした切り分けでは成功した。
- 写真は校正済みPerspectiveCameraと、独自投影行列を持つ旧形式OrthographicCameraの両方が存在する。後者では標準setFromCameraだけでは表示とヒット判定が一致しない。
- 校正済み写真で移動した後、X矢印がSVGの辺計測ヒット領域と重なるとpointerdownがCanvasまで届かないケースも再現した。

## Decision

- PlacedObjectに確定・取消・制約と本体ドラッグを共通化する。写真側は常に移動、3D側は従来の移動・回転・一様拡縮を使う。
- 本体クリックは選択のみ。5 CSS pxを超えたら地面との交点を使って移動し、押下点と配置基準点の差を保持する。Y=0、基準点を幅・奥行き内へ制限する。
- 操作中は描画だけを更新し、終了時にtransformObjectを通してGardenDocumentへ反映する。自動保存の500ms待機・revision競合処理は変更しない。
- 写真側のR3FイベントとTransformControls内部レイは共通の座標変換を使う。コントロールのnative DOMリスナーは解除し、StrictModeの再接続にも対応する。
- PhotoPointerBridgeはSVGに届いた押下を検査し、モデル・ハンドルに当たる場合だけ同じ座標とpointerIdでCanvasへ渡す。辺だけを押した場合や校正・輪郭編集・配置非表示中はSVGの操作を保つ。
- TransformControlsのdomElementはCanvasへ固定する。R3Fのevents.connectedが後から設定されても、写真用レイの設定済みコントロールが未設定インスタンスへ置き換わらないようにする。入力時にも行列を更新する。
- 保存で写真オブジェクトの参照が変わっても、投影条件が同じならカメラを保持する。
- 選択枠は描画専用とする。ハンドル上はハンドル操作を優先し、モデル上は見えているモデルを選択する。完全に隠れたモデルの巡回選択は追加しない。
- 操作中のEscape、pointercancel、blurは復元・捕捉解除・操作状態解除を行う。タブ切り替えと配置表示変更は操作中無効にする。
- タブ初期化は庭IDごとに一度とし、保存更新では変更しない。一覧から開く場合とブラウザ更新は写真付きなら写真、写真なしなら3D。
- ハンドルはcaptureRole=editorとして完成イメージ・サムネイルから除外する。

## Alternatives

- 写真側だけに移動処理を複製すると制約・取消処理が分岐するため採用しない。
- 写真を新形式だけに限定したり旧データを自動変換する方法は既存庭の見え方を変えるため採用しない。
- タブ選択をGardenDocumentやlocalStorageへ保存する方法は、再入場時に写真へ戻る要件と異なるため採用しない。

## Consequences

- API、DTO、DBスキーマ、マイグレーション、EC連携契約に変更はない。
- 正本はGardenDocument。Scene/Object3Dや操作中状態をAPIへ送信しない。
- CanvasのPython APIとMySQL kusakari_canvas_e2eを使用する。ECのJava・kusakari_e2eは今回の変更対象外。
- 追加E2Eは独立した庭を作り、既存庭の更新・全消去を行わない。実ポインター操作で編集し、GETと再読み込みで永続化を照合する。

## 検証の記録

- 修正前の選択・タブ不具合のtrace/画面: `artifacts/e2e/photo-interaction-baseline/`。
- 関連テスト実行のレポート: `artifacts/e2e/photo-interaction-regression/`。
- 既存の写真実寸編集3ケース（legacy / fixed-projection / calibrated）は成功。
- 初回の既存photo-calibrationは現在のUIにない`asset-tree_oak`ボタン待ちでタイムアウトした。失敗traceは保持し、下記の追加対応で解消した。
- 初回checkJsの変更前後比較は既存32件→31件、追加エラー0件だった。比較スクリプトと診断は当時の記録として`artifacts/e2e/check-editor-types.cjs`、`photo-interaction-checkjs.json`に保持する。下記の追加対応後は全フロントの検査が成功する。
- Python lint/compile、フロントlint/buildは成功。ビルドの500kB超チャンク警告は残る。

- 旧形式の本体移動・X/Z矢印・リサイズ・取消・画像出力・保存復元は、接続先固定後に3回連続成功した（`--grep legacy --repeat-each=3`）。
- 追加テスト: `e2e/photo-interaction.spec.ts`、`e2e/editor-transform-regression.spec.ts`。クリック対象は配置IDで特定し、APIの配列順に依存しない。矢印/拡縮ハンドルは描画された色から位置を取得し、実マウスでドラッグする。ストア書き換え・正常系APIモックは使わない。
- 最終検証コマンド: `npm run test:e2e -- e2e/photo-interaction.spec.ts e2e/editor-transform-regression.spec.ts e2e/photo-scale.spec.ts`。
- 最終結果: **9件成功、失敗0件（2.9分）**。HTMLレポートは`artifacts/e2e/photo-interaction-final/report/index.html`、実寸編集の画面/JSONは同フォルダの`scale-evidence/`。今回の移動・選択・タブ・3D操作の再読み込み後画面とGET JSONは`artifacts/e2e/photo-interaction/`。
- 写真の本体ドラッグとX/Z矢印、2画面幅とサイドバー変更、ドラッグ中のPUT抑止、Escape/pointercancel/blur、ハンドル取消、SVG辺とハンドルの重なり、配置非表示、庭範囲制限、画像出力の選択依存がないことを確認した。3Dの本体移動・回転リング・一様拡縮と保存復元も成功した。
- 対象E2EのTypeScript検査も成功。最終ソースのlint/buildとcheckJs差分検査を実行済み。公開API/DBには変更を加えていないためJavaビルドは今回の対象外。
- E2EはCanvas APIを独立起動するため、EC商品検索欄には接続不可表示が出る。ECの購入フローは今回の検証対象に含めていない。新規E2Eの庭は保持し、既存の追跡済みテスト成果物は今回の結果を別フォルダへ保存した上で元の内容へ戻した。

## 追加対応：既存型エラーと写真校正E2E

- `npm run check:js`と`frontend/jsconfig.json`を追加。編集画面だけでなく`frontend/src`全体をcheckJsで検証する。既存のJavaScript推論に合わせstrictは無効。依存パッケージのJavaScript実装まで検査しないよう`maxNodeModuleJsDepth: 0`を明示する。アプリの検査除外やts-ignoreは追加しない。
- Dialog等の任意props、DOMのHTMLElement/SVGElement判定、ApiError判定、OrbitControls/Meshの実クラス判定、CSS変数・カメラ座標・診断関数の型を修正。全体検査で発見した庭作成mutationの引数型と植物プレビューの任意objectIdも修正した。
- 写真校正のテストOは、独立した庭に実APIで1本の初期樹木を保存し、現在の「買い物リスト → 庭に配置」から3地点を実マウスで配置する。初期fixture以外の配置をAPIやストア操作で代替しない。独立カメラによる座標・高さ投影の期待値は維持した。完成イメージは現在のメニューから開く。
- 初期樹木を含む4モデルの読み込み、校正の適用・取消・実寸変更、再読み込みと実API JSONの一致、完成イメージを確認する。庭は検証後も保持する。画像とJSONは`artifacts/e2e/photo-calibration-current/`。
- checkJs（全フロント）、対象3ファイルのE2E TypeScript検査、lint、フロントビルド、Python APIのlint/compileが成功。依存・ロックファイル、API契約、DB構造に変更なし。
- 最終回帰: `npm run test:e2e -- e2e/photo-interaction.spec.ts e2e/editor-transform-regression.spec.ts e2e/photo-scale.spec.ts e2e/photo-calibration.spec.ts` → **11件成功、失敗0件（3.4分）**。レポートは`artifacts/e2e/type-ui-regression/report/index.html`、今回の実寸編集の画像/JSONは`artifacts/e2e/type-ui-regression/scale-evidence/`。全E2Eスイートではなく、本変更に関連する4ファイルを実行した結果である。
