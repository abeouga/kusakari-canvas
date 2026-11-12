"""Prepare local MySQL accounts, settings and Alembic schemas without resetting data."""

import argparse
import getpass
import json
import os
import re
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse

import pymysql
from sqlalchemy import URL, create_engine, inspect, text

from .config import REPO_ROOT, Settings
from .local_mysql import connect_admin, initialize, read_state
from .migrations import current_revision, legacy_revision, migrate, validate_schema
from .setup_files import protect_secret, save_settings
from .startup_errors import safe_error


def file_values(profile: str) -> dict:
    path = REPO_ROOT / ('.env.e2e' if profile == 'e2e' else '.env')
    values = {}
    if path.is_file():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            key, sep, value = line.strip().partition('=')
            if sep and key.startswith('KUSAKARI_CANVAS_'):
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                values[key.strip()] = value
    return values


def profile_config(profile: str, default_port: int) -> dict:
    prefix = 'KUSAKARI_CANVAS_E2E_DB_' if profile == 'e2e' else 'KUSAKARI_CANVAS_DB_'
    saved = file_values(profile)
    values = {key: os.environ.get(prefix + key) or saved.get(prefix + key, '')
              for key in ('USER', 'PASSWORD', 'URL')}
    database = 'kusakari_canvas_e2e' if profile == 'e2e' else 'kusakari_canvas'
    parsed = urlparse((values['URL'] or f'mysql://127.0.0.1:{default_port}/{database}').removeprefix('jdbc:'))
    if parsed.scheme not in {'mysql', 'mysql+pymysql'} or parsed.hostname not in {'127.0.0.1', 'localhost'} \
            or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('自動セットアップのDB接続先は認証情報を含まないローカルMySQL URLに限定します。')
    database = parsed.path.lstrip('/')
    if not re.fullmatch(r'[a-zA-Z0-9_]{1,64}', database):
        raise ValueError('自動セットアップのDB名は英数字・アンダースコアで指定してください。')
    if profile == 'e2e' and not database.startswith('kusakari_canvas_e2e'):
        raise ValueError('E2Eにはkusakari_canvas_e2eから始まる専用DBが必要です。')
    if profile == 'dev' and database != 'kusakari_canvas':
        raise ValueError('開発環境ではkusakari_canvasデータベースを使用してください。')
    user = values['USER'] or ('kusakari_canvas_e2e' if profile == 'e2e' else 'kusakari_canvas_dev')
    if not re.fullmatch(r'[a-zA-Z0-9_]{1,32}', user) or user.lower() == 'root':
        raise ValueError('アプリにはrootではなく専用MySQLユーザーを設定してください。')
    try:
        port = parsed.port or 3306
    except ValueError:
        raise ValueError('DB接続ポートは1〜65535の整数で指定してください。') from None
    if not 1 <= port <= 65535:
        raise ValueError('DB接続ポートが不正です。')
    return {'profile': profile, 'prefix': prefix, 'host': '127.0.0.1', 'port': port, 'database': database,
            'user': user, 'password': values['PASSWORD'], 'explicit_user': bool(values['USER']),
            'url': f'mysql://127.0.0.1:{port}/{database}'}


def connect(config: dict, *, database: bool = True):
    return pymysql.connect(host=config['host'], port=config['port'], user=config['user'],
                           password=config['password'], database=config['database'] if database else None,
                           autocommit=True, connect_timeout=5, read_timeout=5, write_timeout=5, charset='utf8mb4')


def check_connection(config: dict) -> bool:
    if not config['password']:
        return False
    try:
        with connect(config) as connection, connection.cursor() as cursor:
            cursor.execute('SELECT VERSION()')
            validate_version(cursor.fetchone()[0])
            cursor.execute('SHOW GRANTS')
            required = {'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'INDEX', 'DROP',
                        'REFERENCES', 'SHOW VIEW', 'TRIGGER'}
            granted = set()
            for (grant,) in cursor.fetchall():
                match = re.match(r'^GRANT (.+) ON (.+) TO ', grant)
                if not match:
                    continue
                scope = match[2].replace('`', '').replace(r'\_', '_')
                if scope not in {'*.*', config['database'] + '.*'}:
                    continue
                if match[1] == 'ALL PRIVILEGES':
                    granted |= required
                else:
                    granted |= set(match[1].split(', '))
            if not required <= granted:
                print(f'{config["profile"]}: DB操作・移行に必要な権限を準備します。', flush=True)
                return False
        return True
    except pymysql.MySQLError as error:
        print(f'{config["profile"]}: {safe_error(error)}', flush=True)
        return False


def validate_version(version: str) -> None:
    if 'MariaDB' in version or not re.match(r'^8\.(0|4)\.', version):
        raise ValueError('自動セットアップはMySQL 8.0/8.4を対象とします。接続先のバージョンを確認してください。')


def mysql_server_responds(host: str, port: int) -> bool:
    try:
        connection = pymysql.connect(host=host, port=port, user='kusakari_canvas_probe',
                                     password=secrets.token_urlsafe(24), connect_timeout=2,
                                     read_timeout=2, write_timeout=2)
        connection.close()
        return True
    except pymysql.MySQLError as error:
        # A MySQL protocol error proves a server answered. Refused connections,
        # non-MySQL services, and broken handshakes do not count as MySQL.
        code = error.args[0] if error.args else None
        return isinstance(code, int) and code not in {2003, 2006, 2013}


def configured_settings(config: dict) -> Settings:
    os.environ['KUSAKARI_CANVAS_PROFILE'] = config['profile']
    for suffix, value in {'USER': config['user'], 'PASSWORD': config['password'], 'URL': config['url']}.items():
        os.environ[config['prefix'] + suffix] = value
    return Settings.from_env()


def validate_existing_database(admin, config: dict, admin_user: str, admin_password: str) -> None:
    with admin.cursor() as cursor:
        cursor.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=%s',
                       (config['database'],))
        if cursor.fetchone() is None:
            return
    url = URL.create('mysql+pymysql', username=admin_user, password=admin_password,
                     host=config['host'], port=config['port'], database=config['database'])
    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.connect() as connection:
            if inspect(connection).get_table_names():
                revision = current_revision(connection)
                if revision is None:
                    legacy_revision(connection)
                else:
                    validate_schema(connection, revision)
    finally:
        engine.dispose()


def prepare_profile(admin, config: dict) -> None:
    with admin.cursor() as cursor:
        cursor.execute('SELECT Host FROM mysql.user WHERE User=%s', (config['user'],))
        hosts = {row[0] for row in cursor.fetchall()}
        if hosts and not config['explicit_user']:
            config['user'] += '_' + secrets.token_hex(4)
            hosts = set()
        if hosts:
            if not config['password']:
                config['password'] = getpass.getpass(f'既存の専用ユーザー {config["user"]} のパスワード: ')
            with connect(config, database=False) as account, account.cursor() as account_cursor:
                account_cursor.execute('SELECT CURRENT_USER()')
                actual_user, actual_host = account_cursor.fetchone()[0].rsplit('@', 1)
                if actual_user != config['user'] or actual_host not in {'localhost', '127.0.0.1'}:
                    raise ValueError('専用ユーザーはlocalhost/127.0.0.1だけに限定してください。')
            account_hosts = [actual_host]
        else:
            config['password'] = config['password'] or secrets.token_urlsafe(32)
            account_hosts = ['localhost', '127.0.0.1']
        values = {config['prefix'] + suffix: value for suffix, value in
                  {'USER': config['user'], 'PASSWORD': config['password'], 'URL': config['url']}.items()}
        path = REPO_ROOT / ('.env.e2e' if config['profile'] == 'e2e' else '.env')
        # Save before DDL so an interrupted setup can reuse the same generated credentials.
        save_settings(path, values)
        cursor.execute(f'CREATE DATABASE IF NOT EXISTS `{config["database"]}` '
                       'CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci')
        cursor.execute('SELECT @@partial_revokes')
        grant_database = config['database'] if cursor.fetchone()[0] else config['database'].replace('_', r'\_')
        for host in account_hosts:
            if not hosts:
                cursor.execute('CREATE USER IF NOT EXISTS %s@%s IDENTIFIED BY %s',
                               (config['user'], host, config['password']))
            cursor.execute(f'GRANT ALL PRIVILEGES ON `{grant_database}`.* TO %s@%s',
                           (config['user'], host))


def existing_admin(config: dict):
    user = input('MySQL管理者名（Enter=root）: ').strip() or 'root'
    if not re.fullmatch(r'[a-zA-Z0-9_]{1,32}', user):
        raise ValueError('MySQL管理者名が不正です。')
    for attempt in range(3):
        password = getpass.getpass(f'MySQL管理者 {user} のパスワード（保存しません）: ')
        try:
            connection = pymysql.connect(host=config['host'], port=config['port'], user=user, password=password,
                                         autocommit=True, connect_timeout=5, read_timeout=5, write_timeout=5,
                                         charset='utf8mb4')
            return connection, user, password
        except pymysql.MySQLError as error:
            print(safe_error(error), flush=True)
            if error.args[0] != 1045 or attempt == 2:
                raise ValueError('MySQL管理者として接続できません。管理者認証情報を確認してsetup.batを再実行してください。') from None
    raise AssertionError('Unreachable')


def migrate_and_verify(configs: list[dict]) -> list[dict]:
    """Run Alembic to head for each profile and confirm the seeded assets. Shared with reset_database."""
    results = []
    for item in configs:
        settings = configured_settings(item)
        result = migrate(settings)
        engine = create_engine(settings.database_url, hide_parameters=True)
        try:
            with engine.connect() as connection:
                expected = {'tree_oak', 'shrub_boxwood', 'brick_paver', 'bench_wood'}
                if not expected <= set(connection.scalars(text('SELECT id FROM assets'))):
                    raise ValueError('初期アセットが不足しています。DBを確認してください。')
        finally:
            engine.dispose()
        results.append({'profile': item['profile'], 'database': item['database'], 'revision': result['revision']})
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('auto', 'existing', 'managed'), default='auto')
    parser.add_argument('--bin', type=Path, required=True)
    args = parser.parse_args()
    original_profile = os.environ.get('KUSAKARI_CANVAS_PROFILE')
    try:
        state = read_state()
        dev_saved = file_values('dev')
        explicit_url = os.environ.get('KUSAKARI_CANVAS_DB_URL') or dev_saved.get('KUSAKARI_CANVAS_DB_URL')
        explicit_connection = bool(explicit_url or any(
            os.environ.get('KUSAKARI_CANVAS_DB_' + suffix) or dev_saved.get('KUSAKARI_CANVAS_DB_' + suffix)
            for suffix in ('USER', 'PASSWORD')))
        default_port = state['port'] if state and not explicit_url else 3306
        config = profile_config('dev', default_port)
        state_ports = {state['port']} if state else set()
        if state:
            previous_ports = state.get('previous_ports', [])
            if isinstance(previous_ports, list):
                state_ports.update(port for port in previous_ports
                                   if type(port) is int and 1 <= port <= 65535)
        managed = args.mode == 'managed' or (args.mode != 'existing' and state and config['port'] in state_ports) \
            or (args.mode == 'auto' and not mysql_server_responds(config['host'], config['port'])
                and not explicit_connection)
        if managed:
            if explicit_connection and (not state or config['port'] not in state_ports):
                raise ValueError('既存のDB接続設定があります。別DBへ自動変更せず停止しました。')
            state = initialize(args.bin)
            default_port = state['port']
            print(f'Kusakari Canvas用MySQL: 127.0.0.1:{default_port}', flush=True)
        dev = profile_config('dev', default_port)
        configs = [dev, profile_config('e2e', dev['port'])]
        if configs[0]['port'] != configs[1]['port'] or configs[0]['database'] == configs[1]['database']:
            raise ValueError('devとe2eは同じMySQLサーバー上の別DBに設定してください。')
        pending = [item for item in configs if not check_connection(item)]
        if pending:
            if managed:
                admin = connect_admin(state)
                admin_user = 'root'
                admin_password = protect_secret(state['root_secret'], decrypt=True)
            else:
                print('既存MySQLにKusakari Canvas用DB・専用ユーザーを準備します。既存ユーザーのパスワードは変更しません。', flush=True)
                admin, admin_user, admin_password = existing_admin(configs[0])
            with admin:
                with admin.cursor() as cursor:
                    cursor.execute('SELECT VERSION()')
                    validate_version(cursor.fetchone()[0])
                    cursor.execute("SELECT GET_LOCK('kusakari_canvas_database_setup', 30)")
                    if cursor.fetchone()[0] != 1:
                        raise ValueError('別のKusakari Canvasセットアップが実行中です。')
                try:
                    for item in pending:
                        validate_existing_database(admin, item, admin_user, admin_password)
                    for item in pending:
                        prepare_profile(admin, item)
                finally:
                    with admin.cursor() as cursor:
                        cursor.execute("SELECT RELEASE_LOCK('kusakari_canvas_database_setup')")
            admin_password = ''
        results = migrate_and_verify(configs)
        print(json.dumps({'database_setup': 'passed', 'profiles': results}, ensure_ascii=False), flush=True)
        print('MySQLの認証・DB・権限・テーブル準備を確認しました。', flush=True)
        return 0
    except (ValueError, EOFError) as error:
        print(f'DBセットアップを中止しました: {error}', file=sys.stderr)
    except Exception as error:
        print(f'DBセットアップに失敗しました: {safe_error(error)}', file=sys.stderr)
    finally:
        if original_profile is None:
            os.environ.pop('KUSAKARI_CANVAS_PROFILE', None)
        else:
            os.environ['KUSAKARI_CANVAS_PROFILE'] = original_profile
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
