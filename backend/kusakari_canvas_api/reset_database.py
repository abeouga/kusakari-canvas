"""Drop and recreate this project's local Canvas databases.

Run by DB-reset.bat. Nothing here runs at application startup. It runs to the end without asking for a confirmation
or refusing on checks of the target (decision of 2026-11-16, docs/database-reset.md): only the two fixed database
names can be dropped, and connections to them are killed first.
"""

import argparse
import json
import os
import re
import sys

import pymysql

from .local_mysql import ensure_server, read_state
from .migrations import backup_database
from .setup_database import (
    configured_settings,
    connect,
    file_values,
    migrate_and_verify,
    mysql_server_responds,
    profile_config,
)
from .startup_errors import safe_error

SUMMARY_TABLES = ('gardens', 'placed_objects', 'garden_thumbnails', 'garden_image_history')


def load_configs() -> tuple[dict | None, list[dict]]:
    """Read the dev and e2e targets with the same rules as setup_database."""
    state = read_state()
    explicit_url = os.environ.get('KUSAKARI_CANVAS_DB_URL') or file_values('dev').get('KUSAKARI_CANVAS_DB_URL')
    dev = profile_config('dev', state['port'] if state and not explicit_url else 3306)
    configs = [dev, profile_config('e2e', dev['port'])]
    for config in configs:
        if not config['password']:
            raise ValueError(f'{config["profile"]} のDB接続設定がありません。先に setup.bat を実行してください。')
    return state, configs


def start_managed_server(state: dict | None, configs: list[dict]) -> None:
    """Start the Kusakari Canvas MySQL when the settings point at it and it is stopped."""
    port = configs[0]['port']
    if state and port == state['port'] and not mysql_server_responds('127.0.0.1', port):
        print('Kusakari Canvas用MySQLが停止しているので起動します。', flush=True)
        ensure_server(state)


def summarize(config: dict) -> dict:
    database = config['database']
    with connect(config, database=False) as connection, connection.cursor() as cursor:
        cursor.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s', (database,))
        tables = {row[0] for row in cursor.fetchall()}
        rows = {}
        for table in SUMMARY_TABLES:
            if table in tables:
                cursor.execute(f'SELECT COUNT(*) FROM `{database}`.`{table}`')
                rows[table] = cursor.fetchone()[0]
    return {'database': database, 'tables': len(tables), 'rows': rows}


def show_plan(configs: list[dict], summaries: list[dict]) -> None:
    print(f'\n=== 作り直す DB（ポート {configs[0]["port"]}） ===')
    for config, summary in zip(configs, summaries):
        if not summary['tables']:
            print(f'{summary["database"]}（{config["profile"]}）: テーブルなし')
            continue
        rows = '、'.join(f'{table} {count} 行' for table, count in summary['rows'].items())
        print(f'{summary["database"]}（{config["profile"]}）: テーブル {summary["tables"]} 個' + (f'（{rows}）' if rows else ''))
    print('同じ MySQL にあるほかの DB（EC の DB を含む）には触れません。', flush=True)


def kill_connections(configs: list[dict]) -> None:
    """Kill other connections to the target databases (another checkout's API, E2E, a console started Canvas)."""
    killed = 0
    for config in configs:
        with connect(config, database=False) as connection, connection.cursor() as cursor:
            cursor.execute('SELECT id FROM information_schema.PROCESSLIST WHERE db=%s AND id <> CONNECTION_ID()',
                           (config['database'],))
            for (connection_id,) in cursor.fetchall():
                try:
                    cursor.execute(f'KILL {int(connection_id)}')
                    killed += 1
                except pymysql.MySQLError:
                    # A connection of another user cannot be killed; DROP DATABASE then waits for its statement.
                    pass
    if killed:
        print(f'対象の DB への接続を {killed} 個切りました。', flush=True)


def backup(configs: list[dict], summaries: list[dict]) -> None:
    for config, summary in zip(configs, summaries):
        if not summary['tables']:
            continue
        try:
            print(f'バックアップを保存しました: {backup_database(configured_settings(config))}', flush=True)
        except Exception as error:  # noqa: BLE001 -- a failed backup does not stop the reset
            print(f'{config["database"]} のバックアップに失敗しました（{safe_error(error)}）。バックアップなしで作り直します。',
                  flush=True)


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
    args = parser.parse_args()
    original_profile = os.environ.get('KUSAKARI_CANVAS_PROFILE')
    dropped = False
    try:
        if os.environ.get('KUSAKARI_CANVAS_MEDIA_STORAGE', 'database') != 'database':
            raise ValueError('画像を DB の外（S3）に保存する設定の環境は、このスクリプトの対象外です。')
        state, configs = load_configs()
        start_managed_server(state, configs)
        summaries = [summarize(config) for config in configs]
        show_plan(configs, summaries)
        if args.dry_run:
            print('\n--dry-run のため、表示だけで終了します。何も変更していません。')
            return 0
        kill_connections(configs)
        if not args.no_backup:
            backup(configs, summaries)
        for config in configs:
            recreate(config)
            dropped = True
            print(f'{config["database"]} を作り直しました。', flush=True)
        results = migrate_and_verify(configs)
        print(json.dumps({'database_reset': 'passed', 'profiles': results}, ensure_ascii=False))
        print('\nCanvas の DB の初期化が完了しました。start.bat で起動してください。')
        print('EC の DB をまだ初期化していないときは、EC 側の DB-reset.bat も続けて実行してください。')
        return 0
    except ValueError as error:
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
    else:
        print('DB は変更していません。', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
