"""Real Windows launcher/DB boundary checks; see docs/windows-setup.md for their purpose."""

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen
from uuid import uuid4

import pymysql
from sqlalchemy import text

from kusakari_canvas_api import setup_database
from kusakari_canvas_api.config import REPO_ROOT
from kusakari_canvas_api.database import create_database_engine
from kusakari_canvas_api.local_mysql import connect_admin, ensure_server, read_state, verify_directory


def digest_files(repo: Path) -> dict:
    return {name: hashlib.sha256((repo / name).read_bytes()).hexdigest() for name in ('.env', '.env.e2e')}


def digest_data(config: dict) -> str:
    digest = hashlib.sha256()
    with setup_database.connect(config) as connection, connection.cursor() as cursor:
        for table in ('assets', 'gardens', 'placed_objects'):
            cursor.execute(f'SELECT * FROM `{table}` ORDER BY id')
            digest.update(repr(cursor.fetchall()).encode('utf-8'))
    return digest.hexdigest()


def run_setup(repo: Path, output: Path) -> None:
    command = f'"{os.environ["COMSPEC"]}" /d /s /c ""{repo / "setup.bat"}""'
    with output.open('wb') as log:
        result = subprocess.run(command, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT, cwd=repo, timeout=180,
                                creationflags=subprocess.CREATE_NO_WINDOW)
    assert result.returncode == 0, 'Repeated setup failed; inspect private verification log.'
    assert 'MySQL管理者名' not in output.read_text(encoding='utf-8', errors='replace'), 'Admin prompt returned.'


def hold_port(port: int, *, listen: bool = True) -> socket.socket:
    listener = socket.socket()
    listener.bind(('127.0.0.1', port))
    if listen:
        listener.listen()
    return listener


def port_is_available(port: int) -> bool:
    with socket.socket() as listener:
        try:
            listener.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


def launch(repo: Path, output: Path, conflict: str | None = None) -> dict:
    stop = output.with_suffix('.stop')
    stop.unlink(missing_ok=True)
    env = os.environ.copy()
    env['KUSAKARI_CANVAS_STOP_REQUEST_PATH'] = str(stop)
    listeners: list[socket.socket] = []
    requested_ports: dict[str, int] = {}

    if conflict == 'held_requested':
        for name in ('KUSAKARI_CANVAS_PORT', 'KUSAKARI_CANVAS_WEB_PORT'):
            listener = socket.socket()
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            listeners.append(listener)
            requested_ports[name] = listener.getsockname()[1]
            env[name] = str(requested_ports[name])
    elif conflict == 'same_preference':
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        env['KUSAKARI_CANVAS_PORT'] = str(port)
        env['KUSAKARI_CANVAS_WEB_PORT'] = str(port)
        requested_ports['KUSAKARI_CANVAS_PORT'] = port
        requested_ports['KUSAKARI_CANVAS_WEB_PORT'] = port
    elif conflict == 'all_fixed':
        env.pop('KUSAKARI_CANVAS_PORT', None)
        env.pop('KUSAKARI_CANVAS_WEB_PORT', None)
        for port in [8080, *range(18081, 18101), *range(5173, 5200)]:
            try:
                listeners.append(hold_port(port, listen=False))
            except OSError:
                pass
    else:
        selected_ports: set[int] = set()
        for name in ('KUSAKARI_CANVAS_PORT', 'KUSAKARI_CANVAS_WEB_PORT'):
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            while port in selected_ports:
                with socket.socket() as listener:
                    listener.bind(('127.0.0.1', 0))
                    port = listener.getsockname()[1]
            selected_ports.add(port)
            env[name] = str(port)

    command = f'"{os.environ["COMSPEC"]}" /d /s /c ""{repo / "start.bat"}" -NoBrowser"'
    process = None
    api_port = None
    web_port = None
    api_owned = False
    try:
        with output.open('wb') as log:
            process = subprocess.Popen(command, cwd=repo, env=env,
                                       stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    assert process.poll() is None, 'Launcher exited before health checks.'
                    log_text = output.read_text(encoding='utf-8', errors='replace')
                    api_ports = re.findall(
                        r'(?:API起動中:\s*127\.0\.0\.1:|Kusakari Canvas API:\s*http://127\.0\.0\.1:|'
                        r'既存のKusakari Canvas APIを使用します:\s*http://127\.0\.0\.1:|'
                        r'競合解消後に既存のKusakari Canvas APIを使用します:\s*http://127\.0\.0\.1:)(\d+)',
                        log_text,
                    )
                    web_ports = re.findall(
                        r'(?:Web起動中:\s*127\.0\.0\.1:|Kusakari Canvas Web:\s*http://127\.0\.0\.1:)(\d+)',
                        log_text,
                    )
                    if not api_ports or not web_ports:
                        time.sleep(.25)
                        continue
                    api_port = int(api_ports[-1])
                    web_port = int(web_ports[-1])
                    api_owned = 'API起動中:' in log_text
                    try:
                        with urlopen(f'http://127.0.0.1:{api_port}/api/assets', timeout=2) as response:
                            assert response.headers['X-Kusakari-Canvas-Backend'] == 'fastapi'
                            assert len(json.load(response)) == 4
                        with urlopen(f'http://127.0.0.1:{web_port}/api/assets', timeout=2) as response:
                            assert response.headers['X-Kusakari-Canvas-Backend'] == 'fastapi'
                            assert len(json.load(response)) == 4
                        with urlopen(f'http://127.0.0.1:{web_port}/', timeout=2) as response:
                            assert response.status == 200
                        break
                    except OSError:
                        time.sleep(.25)
                else:
                    raise AssertionError('Launcher health checks timed out.')
                assert api_port != web_port, 'API and Web selected the same port.'
                if conflict == 'held_requested':
                    assert api_port != requested_ports['KUSAKARI_CANVAS_PORT']
                    assert web_port != requested_ports['KUSAKARI_CANVAS_WEB_PORT']
                    assert all(listener.fileno() >= 0 for listener in listeners), 'An unrelated port owner was closed.'
                elif conflict == 'same_preference':
                    assert api_port == requested_ports['KUSAKARI_CANVAS_PORT']
                    assert web_port != requested_ports['KUSAKARI_CANVAS_WEB_PORT']
                elif conflict == 'all_fixed':
                    assert api_port not in {8080, *range(18081, 18101)}
                    assert web_port not in set(range(5173, 5200))
                return {'api_status': 200, 'web_status': 200, 'proxy_backend': 'fastapi',
                        'api_port': api_port, 'web_port': web_port}
            finally:
                stop.touch()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    system_root = os.environ.get('SystemRoot')
                    if not system_root:
                        raise RuntimeError('SystemRoot is missing; launcher process tree cannot be stopped safely.')
                    taskkill = Path(system_root) / 'System32' / 'taskkill.exe'
                    subprocess.run([str(taskkill), '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                    process.wait(timeout=10)
                stop.unlink(missing_ok=True)
                if web_port is not None:
                    assert port_is_available(web_port), 'Web port stayed occupied after graceful stop.'
                if api_owned and api_port is not None:
                    assert port_is_available(api_port), 'API port stayed occupied after graceful stop.'
    finally:
        for listener in listeners:
            listener.close()


def managed_checks(repo: Path, output: Path, log_prefix: str, state: dict, configs: list[dict]) -> list[str]:
    checks = []
    suffix = uuid4().hex[:12]
    bad_database = 'kusakari_canvas_e2e_setup_bad_' + suffix
    bad_user = 'kusakari_canvas_setup_bad_' + suffix
    with connect_admin(state) as admin, admin.cursor() as cursor:
        verify_directory(admin, state)
        cursor.execute(f'CREATE DATABASE `{bad_database}`')
        cursor.execute(f'CREATE TABLE `{bad_database}`.foreign_table (id INT PRIMARY KEY)')
    before = digest_files(repo)
    env = os.environ.copy()
    env.update({'KUSAKARI_CANVAS_DB_URL': f'mysql://127.0.0.1:{state["port"]}/{bad_database}',
                'KUSAKARI_CANVAS_DB_USER': bad_user, 'KUSAKARI_CANVAS_DB_PASSWORD': uuid4().hex})
    try:
        with (output / f'{log_prefix}-schema-rejection.log').open('wb') as log:
            result = subprocess.run([sys.executable, '-m', 'kusakari_canvas_api.setup_database', '--bin',
                                     str(Path(state['executable']).parent)], cwd=repo / 'backend', env=env,
                                    stdout=log, stderr=subprocess.STDOUT, timeout=30,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
        assert result.returncode != 0 and digest_files(repo) == before
        with connect_admin(state) as admin, admin.cursor() as cursor:
            cursor.execute('SELECT COUNT(*) FROM mysql.user WHERE User=%s', (bad_user,))
            assert cursor.fetchone()[0] == 0
            cursor.execute(f'SELECT COUNT(*) FROM `{bad_database}`.foreign_table')
            assert cursor.fetchone()[0] == 0
        checks.append('unknown_schema_rejected_before_account_or_config_writes')
    finally:
        assert bad_database.startswith('kusakari_canvas_e2e_setup_bad_')
        with connect_admin(state) as admin, admin.cursor() as cursor:
            cursor.execute(f'DROP DATABASE `{bad_database}`')
    data_before = [digest_data(config) for config in configs]
    with connect_admin(state) as admin, admin.cursor() as cursor:
        verify_directory(admin, state)
        cursor.execute('SHUTDOWN')
    time.sleep(2)
    previous_port = state['port']
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', previous_port))
        listener.listen()
        state = ensure_server(state)
        assert state['port'] != previous_port, 'Managed MySQL kept an occupied port.'
        assert listener.fileno() >= 0 and listener.getsockname()[1] == previous_port
    configs[:] = [setup_database.profile_config('dev', state['port']),
                  setup_database.profile_config('e2e', state['port'])]
    assert all(config['port'] == state['port'] for config in configs)
    checks.append('managed_mysql_reallocated_occupied_port_and_preserved_other_listener')
    result = launch(repo, output / f'{log_prefix}-managed-restart-launch.log', conflict='held_requested')
    assert result['api_status'] == 200
    with connect_admin(state) as admin:
        verify_directory(admin, state)
    checks.append('managed_mysql_restarted_by_launcher_with_original_data_directory')
    assert data_before == [digest_data(config) for config in configs]
    checks.append('managed_mysql_port_change_preserved_application_data')
    for config in configs:
        engine = create_database_engine(setup_database.configured_settings(config))
        try:
            with engine.connect() as connection:
                assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0004'
        finally:
            engine.dispose()
    return checks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', type=Path, default=REPO_ROOT)
    parser.add_argument('--managed', action='store_true')
    args = parser.parse_args()
    repo = args.workspace.resolve()
    setup_database.REPO_ROOT = repo
    output = repo / 'artifacts' / 'fastapi'
    log_prefix = 'windows-setup-' + uuid4().hex[:12]
    output.mkdir(parents=True, exist_ok=True)
    report = {'mode': 'managed' if args.managed else 'existing', 'checks': [], 'result': 'failed'}
    original_profile = os.environ.get('KUSAKARI_CANVAS_PROFILE')
    fixture = str(uuid4())
    configs = [setup_database.profile_config('dev', 3306), setup_database.profile_config('e2e', 3306)]
    try:
        assert setup_database.mysql_server_responds(configs[0]['host'], configs[0]['port'])
        with socket.socket() as non_mysql_listener:
            non_mysql_listener.bind(('127.0.0.1', 0))
            non_mysql_listener.listen()
            non_mysql_port = non_mysql_listener.getsockname()[1]
            assert not setup_database.mysql_server_responds('127.0.0.1', non_mysql_port)
        report['checks'].append('auto_setup_detection_requires_mysql_protocol_not_tcp_only')
        # Dedicated E2E sentinel proves repeated setup preserves nonempty application data.
        with setup_database.connect(configs[1]) as connection, connection.cursor() as cursor:
            cursor.execute('INSERT INTO gardens (id,owner_id,name,width,depth,revision,updated_at) '
                           'VALUES (%s,%s,%s,10,8,0,UTC_TIMESTAMP(6))',
                           (fixture, 'kusakari-canvas-e2e-demo', 'setup verification sentinel'))
        credentials = digest_files(repo)
        data = [digest_data(config) for config in configs]
        for attempt in range(2):
            run_setup(repo, output / f'{log_prefix}-repeated-setup-{attempt}.log')
            assert credentials == digest_files(repo), 'Setup changed established credentials.'
            assert data == [digest_data(config) for config in configs], 'Setup changed existing data.'
        report['checks'].append('two_repeated_setups_preserved_credentials_and_nonempty_data_without_admin_prompt')
        for config, other in ((configs[0], configs[1]), (configs[1], configs[0])):
            try:
                with setup_database.connect({**config, 'database': other['database']}):
                    raise AssertionError('Application account can access the other database.')
            except pymysql.MySQLError as error:
                assert error.args[0] == 1044
        report['checks'].append('dev_and_e2e_accounts_cannot_access_each_others_database')
        state = read_state() if args.managed else None
        if state:
            report['checks'] += managed_checks(repo, output, log_prefix, state, configs)
        else:
            report['launcher'] = launch(repo, output / f'{log_prefix}-launcher.log')
            report['checks'].append('root_launcher_api_web_proxy_and_graceful_stop')
            report['port_conflict_launchers'] = {
                'occupied_preferences': launch(repo, output / f'{log_prefix}-launcher-occupied-preferences.log',
                                                conflict='held_requested'),
                'same_api_web_preference': launch(repo, output / f'{log_prefix}-launcher-same-preference.log',
                                                  conflict='same_preference'),
                'all_fixed_ranges_occupied': launch(repo, output / f'{log_prefix}-launcher-all-fixed-occupied.log',
                                                    conflict='all_fixed'),
            }
            report['checks'] += ['occupied_api_and_web_preferences_fell_back_without_stopping_the_owners',
                                 'same_api_web_preference_selected_distinct_ports',
                                 'exhausted_fixed_ranges_fell_back_to_ephemeral_ports']
        env = os.environ.copy()
        env.update({'KUSAKARI_CANVAS_PROFILE': 'dev', 'KUSAKARI_CANVAS_DB_USER': configs[0]['user'],
                    'KUSAKARI_CANVAS_DB_PASSWORD': uuid4().hex, 'KUSAKARI_CANVAS_DB_URL': configs[0]['url']})
        result = subprocess.run([sys.executable, '-m', 'kusakari_canvas_api', 'serve'], cwd=repo / 'backend', env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        message = result.stdout.decode('utf-8', errors='replace')
        assert result.returncode != 0 and '1045' in message
        assert env['KUSAKARI_CANVAS_DB_PASSWORD'] not in message and configs[0]['password'] not in message
        (output / f'{log_prefix}-safe-authentication-error.log').write_text(message, encoding='utf-8')
        report['checks'].append('authentication_error_1045_reported_without_secret_values')
        report['result'] = 'passed'
        return 0
    finally:
        with setup_database.connect(configs[1]) as connection, connection.cursor() as cursor:
            cursor.execute('DELETE FROM gardens WHERE id=%s AND owner_id=%s', (fixture, 'kusakari-canvas-e2e-demo'))
        if original_profile is None:
            os.environ.pop('KUSAKARI_CANVAS_PROFILE', None)
        else:
            os.environ['KUSAKARI_CANVAS_PROFILE'] = original_profile
        destination = repo / 'artifacts/fastapi' / ('setup-managed-port-verification.json' if args.managed
                                                   else 'setup-existing-port-verification.json')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    raise SystemExit(main())
