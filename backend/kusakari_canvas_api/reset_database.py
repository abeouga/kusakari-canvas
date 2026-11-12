"""Drop and recreate this project's local Canvas databases, only after an explicit confirmation.

Run by DB-reset.bat. Nothing here runs at application startup.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import pymysql

from .local_mysql import _listener_process_ids, _run_powershell, ensure_server, read_state
from .migrations import backup_database
from .setup_database import (
    configured_settings,
    connect,
    file_values,
    migrate_and_verify,
    mysql_server_responds,
    profile_config,
    validate_version,
)
from .startup_errors import safe_error

CONFIRM_PHRASE = 'RESET kusakari_canvas'
EXIT_CANCELLED = 2
SUMMARY_TABLES = ('gardens', 'placed_objects', 'garden_thumbnails', 'garden_image_history')


def load_configs() -> tuple[dict | None, list[dict]]:
    """Read the dev and e2e targets with the same rules as setup_database."""
    state = read_state()
    explicit_url = os.environ.get('KUSAKARI_CANVAS_DB_URL') or file_values('dev').get('KUSAKARI_CANVAS_DB_URL')
    dev = profile_config('dev', state['port'] if state and not explicit_url else 3306)
    configs = [dev, profile_config('e2e', dev['port'])]
    if configs[0]['port'] != configs[1]['port'] or configs[0]['database'] == configs[1]['database']:
        raise ValueError('devとe2eは同じMySQLサーバー上の別DBに設定してください。')
    for config in configs:
        if not config['password']:
            raise ValueError(f'{config["profile"]} のDB接続設定がありません。先に setup.bat を実行してください。')
    return state, configs


def listener_process(port: int) -> dict:
    process_ids = _listener_process_ids(port)
    if process_ids is None:
        raise ValueError(f'TCP {port} を待ち受けているプロセスを調べられません。')
    if len(process_ids) != 1:
        raise ValueError(f'TCP {port} を待ち受けているプロセスを1つに特定できません（{len(process_ids)} 個）。')
    output = _run_powershell(
        f"$p = Get-CimInstance Win32_Process -Filter 'ProcessId = {process_ids[0]}' -ErrorAction Stop; "
        'ConvertTo-Json -Compress @{ name = [string]$p.Name; path = [string]$p.ExecutablePath }')
    try:
        process = json.loads(output or '')
    except json.JSONDecodeError:
        raise ValueError(f'TCP {port} を待ち受けているプロセス (PID {process_ids[0]}) の情報を取得できません。') from None
    if str(process.get('name', '')).lower() != 'mysqld.exe':
        raise ValueError(f'TCP {port} を待ち受けているのは mysqld.exe ではありません（{process.get("name")}）。')
    return {'id': process_ids[0], 'path': process.get('path') or ''}


def server_facts(config: dict) -> dict:
    """Ask the connected server itself where it is, instead of guessing from configuration files."""
    with connect(config, database=False) as connection, connection.cursor() as cursor:
        cursor.execute('SELECT @@port, @@datadir, @@basedir, VERSION(), @@server_uuid')
        port, data, base, version, server_id = cursor.fetchone()
    return {'port': int(port), 'data': data, 'base': base, 'version': version, 'server_id': server_id}


def identify_target(state: dict | None, configs: list[dict]) -> dict:
    """Confirm that the saved settings point at one MySQL running on this PC, or raise without changing anything."""
    port = configs[0]['port']
    managed = bool(state) and port == state['port']
    if state and not managed and port in state.get('previous_ports', []):
        raise ValueError('DB接続設定が、Kusakari Canvas用MySQLの古いポートを指しています。setup.bat を実行して設定を更新してください。')
    if not mysql_server_responds('127.0.0.1', port):
        if not managed:
            raise ValueError(f'MySQL が TCP {port} で応答していません。MySQL を起動してから再実行してください。')
        print('Kusakari Canvas用MySQLが停止しているので起動します。', flush=True)
        if ensure_server(state)['port'] != port:
            raise ValueError('Kusakari Canvas用MySQLのポートが変わりました。もう一度実行して、表示を確認し直してください。')
    process = listener_process(port)
    facts = [server_facts(config) for config in configs]
    if facts[0]['server_id'] != facts[1]['server_id']:
        raise ValueError('devとe2eの接続先が、同じMySQLサーバーではありません。')
    if facts[0]['port'] != port:
        raise ValueError(f'接続した MySQL のポート ({facts[0]["port"]}) が、設定のポート ({port}) と一致しません。')
    validate_version(facts[0]['version'])
    is_managed_data = bool(state) and Path(facts[0]['data']).resolve() == Path(state['data']).resolve()
    if managed and not is_managed_data:
        raise ValueError(f'接続した MySQL のデータの場所 ({facts[0]["data"]}) が、'
                         f'Kusakari Canvas用MySQLのデータの場所 ({state["data"]}) と一致しません。')
    if not managed and is_managed_data:
        raise ValueError('設定は既存の MySQL を指していますが、接続先は Kusakari Canvas用MySQLです。setup.bat を実行して設定を更新してください。')
    return {'managed': managed, 'port': port, 'process_id': process['id'], 'version': facts[0]['version'],
            'data': facts[0]['data'],
            'executable': process['path'] or str(Path(facts[0]['base']) / 'bin' / 'mysqld.exe')}


def summarize(config: dict) -> dict:
    database = config['database']
    with connect(config, database=False) as connection, connection.cursor() as cursor:
        cursor.execute('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=%s', (database,))
        exists = cursor.fetchone()[0] == 1
        cursor.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s', (database,))
        tables = {row[0] for row in cursor.fetchall()}
        if tables and 'alembic_version' not in tables:
            raise ValueError(f'{database} に Kusakari Canvas のマイグレーション履歴 (alembic_version) がありません。'
                             '別の用途の DB の可能性があるので、変更せず停止します。')
        revision, rows = None, {}
        if tables:
            cursor.execute(f'SELECT version_num FROM `{database}`.alembic_version')
            revision = ', '.join(row[0] for row in cursor.fetchall())
            for table in SUMMARY_TABLES:
                if table in tables:
                    cursor.execute(f'SELECT COUNT(*) FROM `{database}`.`{table}`')
                    rows[table] = cursor.fetchone()[0]
        cursor.execute('SHOW GRANTS')
        granted = set()
        for (grant,) in cursor.fetchall():
            match = re.match(r'^GRANT (.+) ON (.+) TO ', grant)
            if match and match[2].replace('`', '').replace(r'\_', '_') in {'*.*', database + '.*'}:
                granted |= {'CREATE', 'DROP'} if match[1] == 'ALL PRIVILEGES' else set(match[1].split(', '))
        # Checked before anything is dropped, so a missing privilege cannot leave the database absent.
        if not {'CREATE', 'DROP'} <= granted:
            raise ValueError(f'DB ユーザー {config["user"]} に、{database} を作り直す権限 (CREATE と DROP) がありません。'
                             'setup.bat を実行して権限を付け直してください。')
    return {'database': database, 'exists': exists, 'tables': len(tables), 'revision': revision, 'rows': rows}


def show_plan(target: dict, configs: list[dict], summaries: list[dict]) -> None:
    mode = 'Kusakari Canvas 専用の MySQL (managed)' if target['managed'] else 'この PC に元からある MySQL (existing)'
    print('\n=== 初期化の対象 ===')
    print(f'MySQL の方式 : {mode}')
    print(f'ポート       : {target["port"]}')
    print(f'プロセス     : mysqld.exe (PID {target["process_id"]})')
    print(f'実行ファイル : {target["executable"]}')
    print(f'データの場所 : {target["data"]}')
    print(f'バージョン   : {target["version"]}')
    print('\n=== 消して作り直す DB（この2つだけ） ===')
    for config, summary in zip(configs, summaries):
        if not summary['exists']:
            print(f'{summary["database"]}（{config["profile"]}、ユーザー {config["user"]}）: まだありません（新しく作ります）')
            continue
        rows = '、'.join(f'{table} {count} 行' for table, count in summary['rows'].items()) or 'なし'
        print(f'{summary["database"]}（{config["profile"]}、ユーザー {config["user"]}）: '
              f'テーブル {summary["tables"]} 個、マイグレーションの版 {summary["revision"] or "なし"}')
        print(f'  主なテーブルの行数 : {rows}')
    print('\n同じ MySQL にあるほかの DB（EC の DB を含む）には触れません。')
    print('消した DB のデータは元に戻せません。庭・配置・写真・画像生成の履歴がすべて消えます。', flush=True)


def assert_no_other_connections(configs: list[dict]) -> None:
    """A running API would keep working against a database that no longer has its tables."""
    busy = 0
    for config in configs:
        with connect(config, database=False) as connection, connection.cursor() as cursor:
            cursor.execute('SELECT CONNECTION_ID()')
            own = cursor.fetchone()[0]
            cursor.execute('SHOW PROCESSLIST')
            busy += sum(1 for row in cursor.fetchall() if row[0] != own and row[3] == config['database'])
    if busy:
        raise ValueError(f'対象の DB に接続中のプロセスが {busy} 個あります。'
                         'Kusakari Canvas（start.bat）や E2E を終了してから再実行してください。')


def recreate(config: dict) -> None:
    # The names come from profile_config, which only accepts kusakari_canvas and kusakari_canvas_e2e*.
    database = config['database']
    if not re.fullmatch(r'kusakari_canvas(_e2e[a-zA-Z0-9_]*)?', database):
        raise ValueError(f'初期化できない DB 名です: {database}')
    with connect(config, database=False) as connection, connection.cursor() as cursor:
        cursor.execute(f'DROP DATABASE IF EXISTS `{database}`')
        cursor.execute(f'CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--no-backup', action='store_true')
    parser.add_argument('--confirm-text')
    args = parser.parse_args()
    original_profile = os.environ.get('KUSAKARI_CANVAS_PROFILE')
    dropped = False
    backups = []
    try:
        if os.environ.get('KUSAKARI_CANVAS_MEDIA_STORAGE', 'database') != 'database':
            raise ValueError('画像を DB の外（S3）に保存する設定の環境は、このスクリプトの対象外です。')
        state, configs = load_configs()
        target = identify_target(state, configs)
        summaries = [summarize(config) for config in configs]
        show_plan(target, configs, summaries)
        if args.dry_run:
            print('\n--dry-run のため、表示だけで終了します。何も変更していません。')
            return 0
        print(f'\n初期化するには、次の文字をそのまま入力してください: {CONFIRM_PHRASE}', flush=True)
        answer = args.confirm_text if args.confirm_text is not None else input('入力: ')
        if answer != CONFIRM_PHRASE:
            print('入力が一致しないため中止しました。何も変更していません。')
            return EXIT_CANCELLED
        assert_no_other_connections(configs)
        if not args.no_backup:
            for config, summary in zip(configs, summaries):
                if summary['tables']:
                    backups.append(str(backup_database(configured_settings(config))))
            for path in backups:
                print(f'バックアップを保存しました: {path}')
        for config in configs:
            recreate(config)
            dropped = True
            print(f'{config["database"]} を作り直しました。', flush=True)
        results = migrate_and_verify(configs)
        print(json.dumps({'database_reset': 'passed', 'profiles': results}, ensure_ascii=False))
        print('\nCanvas の DB の初期化が完了しました。start.bat で起動してください。')
        print('EC の DB をまだ初期化していないときは、EC 側の DB-reset.bat も続けて実行してください。')
        return 0
    except (ValueError, EOFError) as error:
        print(f'\nエラー: {error}', file=sys.stderr)
    except pymysql.MySQLError as error:
        print(f'\nエラー: {safe_error(error)}', file=sys.stderr)
    except Exception as error:
        print(f'\nエラー: {safe_error(error)}', file=sys.stderr)
    finally:
        if original_profile is None:
            os.environ.pop('KUSAKARI_CANVAS_PROFILE', None)
        else:
            os.environ['KUSAKARI_CANVAS_PROFILE'] = original_profile
    if dropped:
        print('DB は空か、途中まで作られた状態です。原因を直してから setup.bat を実行すると、テーブルが作られます。',
              file=sys.stderr)
        for path in backups:
            print(f'消す前のバックアップ: {path}', file=sys.stderr)
    else:
        print('DB は変更していません。', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
