# 2コンテナ・S3・RDS向け構成整理

## Context

EC（Spring Boot）とCanvas（FastAPI）の2 APIをFargateで動かし、静的画面・画像をS3、業務データをRDS MySQLに配置する。AWSリソースの作成、登録、デプロイは今回行わない。
現行のWindows `setup.bat` / `start.bat`、既存MySQL/専用MySQL、SysOverRay操作、別PCでの初回セットアップを維持する。作業開始時点の既存変更は保持する。

## Decision

- ローカル起動とコンテナ起動を分離し、コンテナ内でWindowsセットアップやMySQLの自動導入を実行しない。
- AWSの設定は環境変数で注入し、秘密値・端末固有パス・`.env` をイメージへ含めない。S3にはタスクロールを使用する。
- 配布対象は2 APIイメージと2画面の静的ビルド。画面配信用コンテナをFargateに追加しない。
- 単一サイト内のEC `/` とCanvas `/canvas/` に対応し、既存ローカルURLも維持する。
- 画像の保存処理を業務処理から分離する。既存DB画像を読める互換性を残し、S3選択時は新規の画像実体をDBへ保存しない。取得URLの有効期限を業務データへ固定保存しない。
- APIの健全性確認、接続タイムアウト、終了処理、明示的なDB移行手順を整える。既存データを消去・上書きする起動処理は追加しない。
- 現在の会員/出店者認証は公開用ではない。2026-10-18の利用者回答により、対象を非公開検証環境に確定した。一般公開用の認証実装・AWSプロビジョニングは今回の対象外とする。

## Alternatives / Consequences

一体型コンテナへの統合やフロント配信用Fargate追加は、2 APIの責務と今回のコンテナ数の想定を変えるため採用しない。
ローカルをDocker必須にはしない。Windows利用者は従来のバッチだけで利用できる。
認証・決済・権限制御を無断で別方式へ置き換えない。AWS実機・別PC実機の保証は、ローカル検証やパス変更検証と区別する。

## 完了条件と検証方法

1. 2 APIのLinuxイメージをビルドし、実MySQL・実オブジェクトストレージで起動/停止/再起動を確認する。
2. 静的ビルドを同一オリジンの `/` と `/canvas/` で配信し、商品・庭・モデル・画像・カート・保存再読込を実APIのブラウザー操作で確認する。
3. 画像の新規保存・旧データ読込・履歴・サムネイルを確認し、DBとストレージの実データも照合する。
4. Windowsの通常setup/start、再実行、SysOverRayの可視画面と起動/停止/再起動を確認する。
5. 空白・日本語を含む別配置先とプロジェクト外cwdで、秘密や既存依存をコピーしないセットアップを検証する。
6. 起動前後の実データを照合し、既存庭・商品・注文を消していないことを確認する。
7. 型確認・lint・ビルド・関連E2Eを通す。検証不能な環境条件は完了扱いにしない。

独立検証は、ブラウザーだけでは分からないTLS、DB画像の格納先、コンテナへの秘密混入、終了シグナル、PowerShellの文字コード・引数・プロセス所有判定を対象とする。通常APIはモックにしない。

DB TLS検証では、一時CAとlocalhost専用の証明書を持つ隔離MySQLをloopbackに起動する。
両APIの実コンテナ用設定で移行・起動・読込を行い、信頼されないCAとホスト名不一致では接続を拒否することを確認する。
通常の平文E2Eだけでは証明書検証の有効性を判定できないための独立検証である。既存MySQLサービス、OS/Javaの標準証明書ストア、AWSは変更しない。検証用プロセスのみ停止し、一時データは診断用に保持する。

Linuxコンテナ検証では、新規のラベル付きDockerネットワークと専用のDB/画像保存先だけを作成する。
実際の2 APIイメージを非root・読み取り専用ルート・書込可能な/tmp・共有ネットワーク名前空間で起動する。
通常起動の未移行DB拒否、明示移行の再実行、TLS必須DB、S3画像保存、ブラウザー再読込、SIGTERM終了と再起動後の永続化を確認する。
検証用MySQLとS3互換サービスはAWS外部サービスの代役であり、Fargateの常駐コンテナ数を増やす設計ではない。
接続先は新規フィクスチャに限定し、既存コンテナや通常DBには触れない。終了時は所有ラベルを照合して停止し、診断用のデータ・ログを保持する。

## 統合検証で発見した購入処理のメモリ負荷

512MiBヒープで配布構成を検証すると、買い物リスト取得中にECがメモリ不足となった。
空カートの読込でも全商品と全3D構成を取得し、書込トランザクションではHibernateの変更検出用JSON複製も発生していた。
カート・買い物リスト・資材照合は該当商品のIDだけを取得する。商品データ、3D構成、API応答形式、在庫/カートのロックは維持する。
ヒープ増量だけで回避する方法は採用しない。同じ512MiB設定の実API・MySQLブラウザー検証で再確認する。

## 検証結果（2026-10-18）

| 対象 | 実際の結果・証拠 | 判定範囲 |
|---|---|---|
| 配布用画面と2 API | EC `artifacts/deployment-report.json`: 1 passed。EC/Canvasともcontainer設定で起動。庭・モデル再読込、単一カート、写真・履歴・サムネイル、Origin拒否、欠落アセット404を確認 | Windows上の実API・専用MySQL。Linux、TLS、S3の成功検証ではない |
| 再読込後の画面・JSON | EC `artifacts/deployment/{canvas-reload.png,ec-cart-reload.png,garden.json}`。画面も目視確認 | 検証専用の庭とカート。開発者の庭をテストへ流用しない |
| 既存購入フロー | EC `artifacts/e2e/cart-ux-results.json`: 最終11件成功、約2.2分。注文・再読込・削除・店舗変更・在庫不足・資材照合・障害時の再試行を確認 | 旧seedのbotanicalForm欠落を応答側だけでnullへ補正。期待値は変更せず、旧6商品の保存JSONハッシュも不変 |
| Canvas API/移行 | `artifacts/fastapi/backend-verification.json`、`isolated-mysql-verification.json`: 7群のAPI確認、10移行シナリオ、専用MySQL停止/後片付け成功 | 旧画像・履歴・同revision競合・ロールバック・所有者分離。SQLiteやAPIモックなし |
| S3障害注入 | `artifacts/deployment-refactor/media-outage.json`: 旧DB画像の読込、写真/履歴/サムネイルの保存失敗で既存データとrevisionを維持 | 接続拒否するローカル宛先による障害検証。実S3への成功書込は未検証 |
| 実S3互換ストレージ | `artifacts/deployment-refactor/object-storage.json`: JPEG写真・PNG履歴・サムネイル、キーと画像ハッシュ/MIME、匿名アクセス拒否、再試行の冪等性、両サービス再起動後の復元、共有画像の保持を確認 | SeaweedFS 4.48をloopbackで使用。4オブジェクトを実測しDBにはキーのみ保存。AWS S3/タスクロールやLinuxコンテナの確認ではない |
| DB暗号化接続 | `artifacts/deployment-refactor/database-tls.json`: 両APIのcontainer設定で明示移行・再実行・起動・読書き成功。未信頼CA/ホスト名不一致を移行と通常起動の計8ケースで拒否し、その後正常接続も再確認 | 独立した実MySQL 8.0.46と一時CA、TLS必須の利用者を使用。既存サービスや標準証明書ストアを変更せず、検証用プロセスのみ停止。AWS RDSそのものではない |
| Linuxイメージと実行（過去の失敗） | 両Docker build成功。`artifacts/deployment-refactor/kusakari-verify-9397143bae1f/report.json` の9項目で、MySQL 8.4.11のTLS接続、未移行DB拒否・明示移行、内部loopback通信、非root/readonly/tmp権限、S3の4画像とDBキー照合が成功 | 同報告の全体判定はfailed。Windowsブラウザーワーカーが操作開始前にメモリ確保失敗。過去の失敗は書き換えず保持 |
| Linux統合検証（最終実行） | `D:\KusakariVerification\runs\kusakari-verify-bee332c1df53-nmu8jx8o\evidence\report.json`: 13項目すべて成功。2 API・DB・S3の停止/再起動後の完全復元、実Chromiumのモデル/カート/画像/再読込も成功 | shipping r2イメージ、実TLS MySQL 8.4.11とSeaweedFSを使用。ブラウザー1件10.0秒、再読込後の2画面を目視確認。11検証コンテナは停止済み。AWS実機の結果ではない |
| 整理後のイメージ再作成 | `artifacts/deployment-refactor/rebuild-20261018-r2.json`: 両APIの`verification-20261018-r2`ビルド、MySQLイメージ再取得に成功。配布済み191ファイルのハッシュも一致 | Cドライブ空き3.02GiBにより、実行検証は5GiBの事前条件で非0終了。新規フィクスチャは作成していない。S3互換イメージの再取得は保留 |
| 開発データ保全 | 初回16表一致。最新 `business-data-comparison.json` では商品・注文・庭等15表と元カート64件が不変、空カートのみ5件増加 | 通常画面検証時刻とGET /cartで新規セッションを保存する既存仕様が整合。全表同一の厳格検査は失敗として保持。削除・基準値上書きは行っていない |
| Windows setup/start | 元配置と空白・日本語を含む新規配置でsetup/start成功。新規配置には.env・DB・依存環境をコピーせず、専用MySQLを準備。外部cwdからも実行 | 同一PCでの移設/初期設定検証。OS・既存ツールの違う別PC実機までは保証しない |
| SysOverRay内部制御 | EC `artifacts/deployment/ec-controller-lifecycle.json`、Canvas `sysover-ray2/verification/lifecycle-report.json`、`artifacts/deployment-refactor/portable-canvas-controller.json`: 起動/停止/再起動成功 | 実際のボタンが使用する制御処理の自動検証 |
| SysOverRay可視操作 | 2026-10-18、利用者がEC・Canvas両方で「停止・起動・再起動」のボタン操作について「両方で正常に動いた」と回答 | 利用者による実機確認。エージェントによる画面操作・撮影の証拠とは区別する |
| 配布設定・移行コマンド | EC `artifacts/deployment/config-verification.json`: 2コンテナ、容量上限、非root、読み取り専用、digest/HTTPS必須、上書き拒否、経路を確認。EC migrateも専用MySQLの既存V5で再実行成功 | オフライン検証。ECS登録・AWS接続・既存RDS移行ではない |
| 静的検査 | 両画面のbuild、ECの型/lint/Java build、Canvasのlint/ruff/Python compile、変更PowerShellの構文/BOM確認を実施 | コンテナイメージのbuild成功を意味しない |

Windows起動ではECの設定キー許可と再設定時の保持、setup前の自チェックアウト限定プロセス停止を修正した。
CanvasのSysOverRayは、実際に待受のあるポートだけをHTTP確認するよう変更した。未使用候補27ポートの順次待ちを避け、所有判定は維持した。
可搬性検証用コピーの初回失敗は、検証側が追跡済みSysOverRay配布バイナリまで除外したためだった。コピー規則を修正して再実行し成功した。
専用の検証MySQLは保存先照合後に正常停止し、元のWindows MySQLサービスは停止していない。検証用データは保持した。
一時コピーが変更したCanvasのデスクトップショートカットは元配置へ戻した。

旧モデルの補正は `ProductMapper` のDTO変換に限定する。Hibernate管理下のJSON、形状、版、寸法は変更しない。
初回11件中1件の失敗を修正後、512MiBヒープで11件すべてを再実行し成功した。旧6商品の保存値比較はEC `artifacts/deployment/legacy-model-compatibility.json`。
配布構成E2Eも最新Javaビルドで再実行し、1件成功（21.9秒）、再読込後の画面と庭JSONを再取得した。

DB保全の追加照合は、元64カートの内容ハッシュが当初と一致し、追加5件には商品・配送情報・注文がなく、revisionも0であることを確認した。
通常画面を新規ブラウザーセッションで開く確認は、庭保存を遮断しても空カートを作成し得る。今後の正常系E2Eは引き続き専用DBを使う。

Linux追加検証の初回は、検証データが未配置の植物を履歴の参照先に指定し、正しく400で拒否された。
2回目は、サムネイルのPNG再圧縮を考慮せず元ファイルとのバイト一致を求めた検証側の誤りで停止した。
履歴原本と写真の保存形式は変更せず、サムネイルは寸法・画素一致、ストレージ実体はSHA-256、再起動後の応答は完全一致で確認する。
3回目は画像保存先の照合まで成功し、Windowsのブラウザー検証ワーカーが操作開始前にメモリ確保失敗（exit 134）となった。
停止後にも空き仮想メモリは約1.7GiBだった。検証用DB/S3とNodeのメモリ上限を設け、既存の利用者アプリは終了していない。
失敗記録は `artifacts/deployment-refactor/kusakari-verify-{c0067c2f7b45,12900da026be,9397143bae1f}/` に保持する。
4回目は明示移行まで成功後、Docker内部の`/etc/group`やログの読込に入出力エラーが発生した。
Cドライブの空きは0.22GiB、直前の空き仮想メモリは約0.36GiBだった。その後Dockerは`Docker Desktop is unable to start`を返した。
今回のイメージ・ビルドキャッシュ・検証データもディスクを消費している。空き容量の事前検査を追加し、5GiB未満では新規フィクスチャを作らない。
`artifacts/deployment-refactor/kusakari-verify-0f4d03f8f0d9/report.json` に停止処理の失敗対象を記録した。
この失敗時点では検証Pythonは終了したが、最後のDockerコンテナの停止は未確認だった。その後の復旧で停止を確認し、以下のとおり整理した。Docker全体の初期化、既存データ削除、無関係なサービスの停止は行っていない。

### 利用者承認後の容量整理・Docker復旧

利用者の「ディスクを減らしてくれ」「再起動を許可する」を受け、Docker Desktopを通常の再起動コマンドで復旧した。
復旧後、最後の実行を含む4回分44コンテナの停止と所有ラベルを確認した。各実行レポートの対象一覧と照合して、44コンテナ、40専用ボリューム、4付随匿名ボリューム、4ネットワークを削除した。
当日のAPIビルドに属する未使用・非共有キャッシュ16件だけをIDで選び、771.3MBを整理した。エージェントは全体pruneやイメージ削除を実行していない。
一時コピーの依存ファイル・ビルド出力と3つの検証専用MySQLデータ領域も、停止と絶対パスを確認して削除した。
一括の計算パスによる削除は保護規則で拒否されたため、その操作では何も削除していない。その後、検査済みの個別LiteralPathに限定した操作が成功した。junctionはリンクのみを外し、参照先のソースを残した。
元リポジトリ・通常DB・商品画像は削除対象外で、検証記録とログも保持した。削除した検証DBの直接復元用バックアップは作っていないが、検証データ・依存ファイルは再生成できる。

Cドライブの空きは当初1.38GiB、上記Windows一時データ整理後2.438GiBだった。その後9.663GiBになったが、全増加量をこちらの限定整理の成果とはしない。
18:13台には、こちらが発行していない別のDocker全体整理をイベントで検出した。既存の停止コンテナ4件、検証用を含むイメージ11件、残りのビルドキャッシュが削除され、`postgresdb`だけが正常稼働している。
検出時点では実行主体が不明だったため、並行整理の有無と検証イメージ再作成の可否を利用者に確認した。その後「Dockerの整理は完了した。検証用イメージを再作成してよい」と回答があり、再ビルドを開始した。
通常のEC/CanvasのAPI・画面4箇所はHTTP 200で、業務データ比較レポートも整理前と同一だった。以前の空カート5件増加という既知差分は保持し、厳格な全表一致は成功に変更していない。
詳細は `artifacts/deployment-refactor/disk-cleanup-20261018.json` に記録する。過去の実行レポートの`retained*`は当時の状態であり、現在の残存を意味しない。

利用者はその後「Dockerの整理は完了した。検証用イメージを再作成してよい」と回答した。並行整理の確認待ちは解消し、再作成後のLinux検証を続行する。
再開前の監査では、検証本体が成功しても終了処理だけ失敗した場合にコマンドが終了コード0を返す不備を修正した。
報告書を保存してから非0終了し、元の検証例外がある場合はそれを維持する。未移行DBの拒否も任意の異常終了では成功とせず、APIごとの終了コードとOOM未発生を照合する。
これは検証制御の成否を正しく伝える変更で、アプリの正常系APIをモックで置き換えるものではない。実Linuxの全フロー確認を引き続き必要とする。

### 再作成結果と再度の容量制約

両APIのLinux/amd64イメージを`verification-20261018-r2`として再作成し、MySQL 8.4イメージも取得した。イメージIDは`rebuild-20261018-r2.json`に固定して記録する。
再作成前のCドライブ空き12.37GiBに対し、再作成とMySQL取得後の実測は3.02GiBとなった。
今回のビルド時間帯に作成された未使用・非共有キャッシュ39件をIDで限定して削除し、Dockerの表示では2.227GBを回収した。全体prune、イメージ・コンテナ・ボリューム削除は実行していない。
削除対象は再生成可能で、両API/MySQLと既存PostgresイメージのIDが維持されていることを確認した。[対象IDを絞るフィルター仕様](https://docs.docker.com/reference/cli/docker/buildx/prune/#provide-filter-values---filter)を使用した。
ただし、Windows側の空き容量は3.02GiBのままだった。Dockerの仮想ディスクファイル長は13.87GiB、Windowsページファイル割当は20,384MiBと確認したが、空き減少の全量を一つの要因へ断定しない。
管理者権限のない現在のセッションで仮想ディスク圧縮やページファイル変更は行わず、無関係なアプリや仮想マシンも終了していない。

実行検証コマンドは空き5GiB未満の事前検査で終了コード1となり、新規の検証コンテナ・DBを作らず停止した。安全条件を下げて続行していない。
S3互換イメージの再取得と、Linuxでの終了・再起動復元・ブラウザーE2Eは残っている。空きを10GB程度以上確保し、再作成済みイメージは残すよう利用者へ依頼した。
通常環境4箇所はHTTP 200、既存`postgresdb`は正常稼働。業務データ比較JSONは再作成前と同一で、既知の空カート5件を除く新たな差分はない。
静的な配布設定検査、配布191ファイルのハッシュ照合、変更した検証コードのRuff/compileallは通過した。これをLinux実行検証の成功とは扱わない。

### 検証ファイルだけを別ドライブへ保存する場合

利用者の選択により、Docker全体の保存先や既存Postgresは移動しない。検証用の静的サイト、移設確認用コピー、診断記録だけを外付けドライブへの配置対象とする。
Linux検証には任意の既存ディレクトリを指定する`--work-root`を追加した。ドライブ文字を実装へ固定せず、他PCでも保存先を選べる。
指定時は毎回新しいディレクトリを作り、証明書・検証用資格情報・ログ・ブラウザー一時ファイル・画像・JSONと、新規MySQL/S3のデータをその下へ置く。
MySQL/S3はその実行専用のbind mountとし、通常DBや既存Dockerボリュームを流用しない。保存先にはアクセス制限した専用フォルダーを使用する。
APIの`/tmp`は配布イメージの所有権を検証するため従来どおり専用Dockerボリュームを使用する。イメージ、Docker管理情報とAPIの一時ボリュームはDockerの従来保存先に残る。

実行例はCanvasの`backend`を作業ディレクトリとする。静的サイトの所在は移動後の実パスを指定する。

```powershell
.\.venv\Scripts\python.exe -m verification.verify_linux_containers `
  --canvas-image kusakari-canvas-api:verification-20261018-r2 `
  --ec-image kusakari-ec-api:verification-20261018-r2 `
  --site 'D:\KusakariVerification\deployment-site-v2\site' `
  --work-root 'D:\KusakariVerification\runs'
```

外付け保存先の空きだけでなくWindowsのシステムドライブも別に検査し、どちらかが5GiB未満なら新規フィクスチャ作成前に停止する。
`TEMP`を別ドライブへ変更して容量不足を見逃すことを防ぐための独立検査であり、通常APIのモックや成功扱いへの変更ではない。
Docker保存先がさらに別のドライブの場合は、その空きも別途確認する。外付けへの配置だけではメモリ不足やDocker側の容量不足は解消しない。
新しい保存先でのMySQL/S3起動、再起動後の永続化とブラウザーE2Eは、容量条件を満たしてから実行し、コード変更やファイルコピーの成功とは区別する。

2026-10-18、13ディレクトリ・1,406ファイル（585,492,108 bytes、約558MiB）を`D:\KusakariVerification`へコピーし、元ファイルとのサイズ・SHA-256一致を全件確認した。
配布サイト191ファイルは配布時のmanifestとも一致した。保存先のアクセス権は現在の利用者・SYSTEM・Administratorsに限定した。
C側の元コピーを削除するコマンドは、プロセス起動前に実行環境の保護機能から拒否された。削除は実行されず、元13ディレクトリは残っている。別手段による削除は行っていない。
Cの空きは2.978GiB、Dは115.166GiB。`TEMP`/`TMP`もDに向けた実コマンドがCの容量不足を検出して終了コード1となり、新しい検証ディレクトリ・コンテナを作っていないことを確認した。
Ruff・compileall・CLIヘルプは成功し、既存の4イメージのIDは不変、Postgresはhealthy、通常EC/CanvasのAPI・画面4箇所もHTTP 200だった。
記録は`artifacts/deployment-refactor/external-storage-20261018.json`と、外付け保存先の`relocation-report.json`に置く。Dへのコピー完了を、C側の容量回復やLinux E2E完了とは扱わない。

その後、利用者から削除の明示許可を受け、1,406ファイルのサイズ・SHA-256を再照合して一致を確認した。
検査済みのC側13パスに限定して再試行したが、実行環境は今回もプロセス作成前に削除を拒否した。C側13フォルダーもD側13フォルダーも残り、削除は未実行である。
別の手段で削除制限を回避せず、外付け保存先の`manual-cleanup-targets.txt`に元パスと対応する保管先を記録した。
最新のC空きは2.975GiB、Dは115.166GiB。検証用コピーを手動削除できてもCは概算3.52GiBで、5GiBの開始条件にはなお不足する。既存Postgresはhealthyだった。

### 利用者によるC側コピー削除とD保存先の接続確認

利用者が管理者用スクリプトを実行した後、`D:\KusakariVerification\cleanup-logs\20261018-212425-095abe92c9ff4241bb49f3509967071d.json`で13ディレクトリの削除完了、エラーなしを確認した。
読取検査でもC側13ディレクトリはすべて存在せず、対応するD側コピーは残っていた。配布191ファイルのmanifest SHA-256も一致した。
スクリプト自身が測定したC空きは5.906GiBから6.454GiBへ増えた（約0.548GiB）。それ以前の容量増加まで、この削除の成果に含めない。
`relocation-report.json`の`SourceRetained`はコピー時点の記録であり、現在の残存状況はこの削除ログと実体検査を参照する。

S3互換イメージ`chrislusf/seaweedfs:4.48`を再取得した。digestは`sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`。
C空き約6.45GiBとD空き約115.16GiBの条件下で、D保存先を使うLinux検証を開始した。
`D:\KusakariVerification\runs\kusakari-verify-07be68f138ef-_mq8lxg5\evidence\report.json`はfailedで、成功項目は0件。
Windows側に新規MySQL用ディレクトリは存在したが、Docker内部に`/mnt/host/d`がなく、bind mount元が存在しないとしてコンテナ作成前に拒否された。
この実行では検証用コンテナ・ボリュームを作成していない。専用ネットワーク、証明書、一時フォルダーと失敗記録は保持した。

利用者の許可を受け、Dドライブの再認識を目的として21:36台にDocker Desktopの通常再起動を実行した。
21:37台のバックエンドログは、`Docker\run\dockerInference`の削除時にWindowsエラー1920（ファイルへアクセスできない）で起動を中断したと記録している。
同ファイルは0 bytesのreparse pointで、読取検査の`Get-Acl`と`fsutil reparsepoint query`も1920となった。ファイル削除、初期化、VHD/DB移動は実行していない。
再起動前の既存`postgresdb`はhealthyだったが、再起動後の復旧とDドライブの再認識は未確認である。
一時通信フォルダーのみを削除せず退避する復旧案を提示し、追加許可を確認している。この時点のC空きは約6.83GiBであり、今回の直接の停止要因は5GiBの容量検査ではない。
その後、指定した180秒を超えても戻らない今回の再起動/状態照会CLI子プロセスだけを、PID・親PID・実行パス・引数の一致を確認して終了した。Dockerバックエンドの強制終了は行っていない。
WSL一覧は`docker-desktop: Stopped`。通常のWindows EC/CanvasのAPI・画面4箇所はHTTP 200で、DockerのVHDファイルも元の場所に存在した。ただしVHDの存在だけではコンテナデータの整合性を確認したことにはならない。
この最終確認ではC空き7.134GiB、D空き115.166GiB、空き仮想メモリ6.708GiB。`D:\KusakariVerification\docker-restart-20261018.json`に記録した。Docker/Postgresの復旧とDの再認識は未完了である。

### Docker復旧待ちの追加確認

21:43の再確認でも`docker-desktop`はStoppedで、起動エラー後の復旧は確認できなかった。一時通信フォルダーの退避は追加許可待ちのため実行していない。
ECのオフライン配布検査へ`--work-root`を追加し、今回以降の検証用JSON/一時雛形をDへ保存できるようにした。既存の未指定時の出力先は維持する。
空の指定値を拒否し、既存ファイルを保存先に指定した実コマンドも非0終了することを確認した。
実際の配布雛形・生成処理・経路関数を使う6項目は成功した。結果は`D:\KusakariVerification\runs\kusakari-task-render-nYkHDf\config-verification.json`と、外部cwd・日本語/空白保存先で実行した`D:\KusakariVerification\設定検証 空白\kusakari-task-render-zfhYZ0\config-verification.json`。
変更した検査スクリプトのNode構文確認、ESLint、差分空白検査も成功した。AWS通信・登録・デプロイは行っていない。
両リポジトリ直下とscripts配下のPowerShell 17ファイルをWindows PowerShell 5.1.26100.9711で解析し、構文エラー0、日本語を含むファイルのUTF-8 BOM不備0、最大499行だった。
これは通常setup/startの新たな実行や別PC実機の確認ではなく、現在のソースに対する追加静的検査である。Linuxの未完了項目や開発DBの既知差分を成功扱いに変更していない。

### 追加許可後の通信フォルダー退避（21:53）

利用者の許可後、Docker Desktop/バックエンドのプロセスが存在せず、WSLもStoppedであることを確認した。
許可対象`C:\Users\t_abe\AppData\Local\Docker\run`の実パス、再解析ポイントではない親/対象ディレクトリ、想定どおりの0 bytes通信ファイル2件、退避先が未存在で同じ親の下にあることを照合した。
同フォルダーを`run-quarantine-20261018-215228`へ名前変更した。削除はせず、元の2ファイルは保持している。
Docker Desktopを通常起動すると新しい`run\dockerInference`は作られたが、次に`C:\Users\t_abe\AppData\Local\docker-secrets-engine\engine.sock`で同じWindowsエラー1920が発生した。
後者のフォルダーは許可済みのパス外なので変更していない。読取検査では0 bytesの`engine.sock`1件のみで、再解析ポイント照会も1920となった。追加の退避許可を確認している。
DockerのWSLはStopped、Postgres復旧とD bind mountの確認は未実施。応答しなくなった今回のversion照会CLIだけを所有照合後に終了し、バックエンドの強制終了は行っていない。
通常Windowsの両APIはHTTP 200。DockerのVHDは元の場所に存在し長さも維持されているが、内部データの正常性は未確認である。
イメージ・DB削除、Docker保存先変更、設定ファイル編集はしていない。C空き7.133GiB、D空き115.162GiB。記録は`D:\KusakariVerification\docker-recovery-20261018-2153.json`。

### 通信フォルダー追加退避後の復旧とLinux統合成功（21:58〜22:02）

追加許可を受け、Docker Desktop/バックエンドの停止と、指定した2フォルダーに0 bytes通信ファイルが各1件だけ存在することを確認した。
`Docker\run`を`Docker\run-quarantine-20261018-215818`へ、`docker-secrets-engine`を同じ親の`docker-secrets-engine-quarantine-20261018-215818`へ退避し、Docker Desktopを起動した。いずれも削除していない。
Docker 29.3.0 / Desktop 4.66.0のLinux/amd64エンジンが応答し、既存Postgresは同じコンテナID・ボリュームでhealthyとなった。
EC・Canvas・MySQL・SeaweedFS・Postgresの5イメージのIDが再起動前と一致した。Docker内の`/mnt/host/d`と検証用フォルダーも認識された。
DB/イメージ移動、Docker保存先変更、設定編集は行っていない。復旧記録は`D:\KusakariVerification\docker-recovery-20261018-2158.json`。

新規実行`kusakari-verify-bee332c1df53`は13項目すべて成功し、検証本体は終了コード0、終了処理の失敗は0件だった。
MySQL/S3データ、証明書、ブラウザー一時ファイルと証拠は`D:\KusakariVerification\runs\kusakari-verify-bee332c1df53-nmu8jx8o`に保持した。
ECはSIGTERMから1.08秒・exit 143、Canvasは1.92秒・exit 0で終了し、強制kill/OOMなし。その後API・DB・S3を起動し直して商品・庭・履歴・サムネイルの完全一致を確認した。
Chromium検証は1件成功（全体10.0秒）。`evidence/canvas-reload.png`のモデル表示・読み込み済み1/1と、`ec-cart-reload.png`の1商品・数量1・合計8,600円を目視確認した。
正常系APIはモックにせず、保存した庭JSONも実APIの再取得値と一致した。検証用コンテナ11件はすべて停止し、通常稼働中のDockerコンテナは既存Postgresのみとなった。

通常DBの保全比較も読み取り専用で再実行した。結果JSONのSHA-256は復旧前と同じ`BBCBD41284EE931D6586128FC97BDF2F1D0F17AFB6774BD9DA366F1AAADBF53D`で、追加差分はない。
既知の空カート5件増加は残るため厳格な比較は終了コード1・`matched: false`のまま保持した。その他15表と元64カートの不変を再確認し、基準値の更新やカート削除は行っていない。
比較ツールに`--output-dir`と読取専用の`--baseline`を追加し、今回の比較結果は`evidence/preservation/business-data-comparison.json`へ保存した。
元行の不変を確認できなかった場合には削除数を0と断定せずnullにするよう、診断表示も修正した。今回の実測は元行不変である。Ruffと実DBでの比較処理を確認した。
検証終了後の空きはC 7.066GiB、D 114.962GiB、空き仮想メモリ3.125GiB。容量値は測定時点の値であり、今後の余裕を保証しない。

## 確認範囲と残る実機検証

S3互換保存の独立検証は完了した。ブラウザー上の同じData URLだけでは画像本体がMySQLから外れたか判定できないため、実MySQL・実API・ローカルSeaweedFSを使用した。
専用loopbackポートと新規の検証保存先だけを使用し、テレメトリを無効化した。AWSには接続していない。

- Linux APIを使ったブラウザーE2E、SIGTERM終了、全サービス再起動後の復元検証は最終実行で成功した。過去の容量不足・D bind mount失敗・Docker起動失敗のレポートは当時の記録として保持する。
- 実AWS S3のタスクロール、RDS接続、Fargate実機のネットワーク・一時領域権限・負荷は今回未検証。ローカルでのTLS/ホスト名拒否検証とは区別する。依頼どおりAWSプロビジョニングやデプロイは実施していない。
- computer-useスキル指定ランタイムがないため、エージェントによるSysOverRay可視操作は実施していない。可視ボタン操作は利用者がEC・Canvas両方で正常と確認したため、この確認を別の証拠として採用する。
- 別PC実機のセットアップ確認は残っている。同一PC内のクリーンな別配置検証を、別OS環境での成功と同一視しない。

したがって「デプロイ可能性と別PC/SysOverRayの全面保証が完了した」とは判定しない。

## 残る実機検証と保持対象

C側13ディレクトリの削除は利用者実行により完了し、D側の対応コピーを保持している。Docker・既存Postgres・D保存先の認識は復旧し、新しい独立実行のLinux統合検証も完了した。
最新のC空きは約7.07GiB。検証用DB/S3と証拠はD、DockerイメージとAPIの一時ボリュームは従来のDocker保存先にある。
過去4回分の検証リソース整理は完了している。今回の成功実行の停止済みコンテナ・専用ボリューム・ネットワークと、コンテナ作成前に失敗した`kusakari-verify-07be68f138ef`のネットワーク/診断記録は保持する。
退避した通信フォルダー3件も削除せず保持する。通常起動中のDockerを止めたり、古い通信ファイルを稼働中のrunへ戻したりしない。
10GB程度以上の空きは今回の容量不足への作業上の目安であり、将来の全負荷に対する必要容量の保証ではない。
Windowsでの購入回帰・配布画面・実S3互換保存・DB TLSは実行済みで、SysOverRay可視操作も利用者が確認した。
別PC実機のセットアップ確認は別途必要となる。利用者へOS、両setup/startとSysOverRay停止/起動/再起動の実行結果を依頼した。
AWS側を確認する場合は、利用可能な既存の非公開検証環境が必要。今回の依頼の範囲を超えてAWSを新規作成しない。

前回までのWindows検証用S3/API/MySQL子プロセスは停止済み。4回分のDocker検証コンテナも復旧後に停止を確認し、承認された容量整理で削除した。
両リポジトリの静的検査と差分空白検査も通過した。改行コード変換と既存THREE.Clockの警告は残るが、今回の追加エラーではない。
