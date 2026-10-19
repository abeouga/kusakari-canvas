import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

import pymysql

from kusakari_canvas_api.config import REPO_ROOT


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tasks", nargs="+", choices=("verify:api", "test:e2e"), default=["verify:api", "test:e2e"])
    tasks = parser.parse_args().tasks
    executable = os.environ.get("KUSAKARI_CANVAS_MYSQL_BIN")
    executable = str(Path(executable) / "mysqld.exe") if executable else None
    executable = executable if executable and Path(executable).is_file() else (
        shutil.which("mysqld.exe") or shutil.which("mysqld"))
    if not executable or not Path(executable).is_file():
        raise ValueError("Install MySQL Server or put mysqld on PATH to run isolated real-MySQL verification.")
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(4)
    default_root = Path(tempfile.gettempdir()) / "kusakari-canvas-verification"
    verification_root = Path(os.environ.get("KUSAKARI_CANVAS_VERIFICATION_ROOT", str(default_root)))
    root = verification_root / stamp
    data = root / "data"
    root.mkdir(parents=True)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    print("Initializing an isolated temporary MySQL instance.", flush=True)
    with (root / "mysql.log").open("w", encoding="utf-8") as log:
        initialized = subprocess.run([executable, "--no-defaults", "--initialize-insecure", f"--datadir={data}",
                                      "--console"], stdout=log, stderr=subprocess.STDOUT,
                                     creationflags=flags, timeout=120, check=False)
        if initialized.returncode:
            raise RuntimeError("MySQL initialization failed; inspect the isolated mysql.log.")
        process = subprocess.Popen([executable, "--no-defaults", f"--datadir={data}", f"--port={port}",
                                    "--bind-address=127.0.0.1", "--mysqlx=0", "--console"],
                                   stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
        connection = None
        verified_instance = False
        password = secrets.token_urlsafe(32)
        results = {"time": datetime.now(UTC).isoformat(), "mysql_port": port,
                   "database": "kusakari_canvas_e2e", "existing_mysql_service_modified": False,
                   "temporary_instance": True, "result": "failed"}
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Isolated MySQL exited before startup.")
                try:
                    connection = pymysql.connect(host="127.0.0.1", port=port, user="root", password="",
                                                 autocommit=True, connect_timeout=2)
                    break
                except pymysql.MySQLError:
                    time.sleep(.25)
            if connection is None:
                raise RuntimeError("Isolated MySQL startup timed out.")
            with connection.cursor() as cursor:
                cursor.execute("SELECT @@datadir, VERSION()")
                actual_directory, version = cursor.fetchone()
                if Path(actual_directory).resolve() != data.resolve():
                    raise RuntimeError("Unexpected MySQL instance; refusing to configure it.")
                verified_instance = True
                results["mysql_version"] = version
                cursor.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s", (password,))
                cursor.execute("CREATE DATABASE kusakari_canvas_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
            connection.close()
            connection = None
            env = os.environ.copy()
            env.update({"KUSAKARI_CANVAS_PROFILE": "e2e", "KUSAKARI_CANVAS_E2E_DB_USER": "root",
                        "KUSAKARI_CANVAS_E2E_DB_PASSWORD": password,
                        "KUSAKARI_CANVAS_E2E_DB_URL": f"mysql://127.0.0.1:{port}/kusakari_canvas_e2e",
                        "KUSAKARI_CANVAS_BACKUP_DIR": str(root / "backups")})
            npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
            if not npm:
                raise ValueError("npm is missing.")
            for task in tasks:
                args = [os.environ.get("ComSpec", "cmd.exe"), "/d", "/s", "/c", f'npm run {task}'] \
                    if os.name == "nt" else [npm, "run", task]
                print(f"Running {task} against isolated real MySQL at 127.0.0.1:{port}", flush=True)
                task_log = root / f"{task.replace(':', '-')}.log"
                with task_log.open("wb") as task_output:
                    code = subprocess.run(args, cwd=REPO_ROOT, env=env, stdout=task_output, stderr=subprocess.STDOUT,
                                          creationflags=flags, check=False).returncode
                results[task] = code
                if code:
                    results["failed_task"] = task
                    print(f"{task} failed; diagnostics are preserved with the temporary MySQL logs.", flush=True)
                    return code
                print(f"{task} passed.", flush=True)
            results["result"] = "passed"
            return 0
        finally:
            if connection is not None:
                connection.close()
            if verified_instance and process.poll() is None:
                try:
                    shutdown = pymysql.connect(host="127.0.0.1", port=port, user="root", password=password,
                                               autocommit=True, connect_timeout=2)
                    with shutdown.cursor() as cursor:
                        cursor.execute("SHUTDOWN")
                    shutdown.close()
                except pymysql.MySQLError:
                    pass
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                # This is only the child process started above, never the system MySQL service.
                process.terminate()
                process.wait(timeout=10)
            results["isolated_mysql_stopped"] = process.poll() is not None
            log.flush()
            log.close()
            if results["result"] == "passed" and results["isolated_mysql_stopped"]:
                resolved_root = root.resolve()
                if resolved_root.parent != verification_root.resolve() or resolved_root.name != stamp:
                    raise RuntimeError("Refusing to remove a temporary directory outside this verification run.")
                shutil.rmtree(resolved_root)
                results["temporary_instance_cleaned"] = True
            output = REPO_ROOT / "artifacts/fastapi"
            output.mkdir(parents=True, exist_ok=True)
            (output / "isolated-mysql-verification.json").write_text(json.dumps(results, indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
