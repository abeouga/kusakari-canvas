# 商品一覧の接続失敗と復旧（2026-10-19）

## 原因と対応

ローカルECが古いビルド済みJARを起動しており、CanvasのOriginに対して
`/api/cart` が403 `ORIGIN_REJECTED` を返していた。現在のECソースには
Canvas接続許可があるが、`start.bat` はJARを再ビルドしないため反映されていなかった。
ECで `npm run build:api` を実行し、この作業フォルダのAPIを8086で再起動して復旧した。
ソース更新後はECのAPI変更をビルドしてから起動する。

商品取得はカートの店舗IDに依存する。カート取得が失敗すると商品クエリは未実行のまま
pendingとなるため、従来は商品一覧に読み込み中と表示され続けた。
ProductBrowserでカート取得エラーを表示し、再取得ボタンが失敗したクエリを再試行するよう修正した。

## 検証

- 開発API：Canvas Originのカート要求が403から200となり、実画面の商品一覧と配置ボタンを確認。
- `npx playwright test --config playwright.product-browser.config.ts`：1件成功。
  ECカート通信のみを障害注入として遮断し、エラー表示と読み込み表示の終了を確認。
  遮断解除後は実EC・Canvas APIと各専用MySQL DBを使用し、商品再取得、配置、保存、再読み込みを確認。
- 新しい庭とセッションを使用し、既存の庭・商品・カートは削除していない。
- 成功時の再読み込み画像と庭API JSONはPlaywright成果物に保存。
- Canvas lint、フロントビルド、追加E2E・設定の型チェック、EC Javaビルドが成功。

実行エージェントではWindowsの一時フォルダがサンドボックスのパスに差し替わり、
JDKのローカルソケット作成に失敗した。今回の実行プロセスに限り
`-Djdk.net.unixdomain.tmpdir` でECの `.runtime` を指定して起動を確認した。
一般の利用者向けの環境変数や起動スクリプトは変更していない。
