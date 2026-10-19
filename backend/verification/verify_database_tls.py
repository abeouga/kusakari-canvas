"""Exercise both real container-profile APIs against an isolated TLS-only MySQL.

No AWS resources, global trust stores, existing databases or OS services are changed.
Generated certificates, database files and redacted diagnostics stay in a new temp directory.
"""
import argparse
import ipaddress
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pymysql
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from kusakari_canvas_api.config import BACKEND_ROOT, REPO_ROOT


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def certificates(root, server_name="localhost", include_loopback=False):
    def issue(name, key, issuer=None, issuer_key=None, ca=False):
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
        now = datetime.now(UTC)
        builder = (x509.CertificateBuilder().subject_name(subject)
                   .issuer_name(issuer.subject if issuer else subject).public_key(key.public_key())
                   .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
                   .not_valid_after(now + timedelta(days=2))
                   .add_extension(x509.BasicConstraints(ca=ca, path_length=0 if ca else None), critical=True))
        if not ca:
            names = [x509.DNSName(server_name)]
            if include_loopback:
                names.append(x509.IPAddress(ipaddress.ip_address("127.0.0.1")))
            builder = (builder.add_extension(x509.SubjectAlternativeName(names), critical=False)
                       .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False))
        return builder.sign(issuer_key or key, hashes.SHA256())

    ca_key, server_key, untrusted_key = (rsa.generate_private_key(65537, 2048) for _ in range(3))
    ca = issue("Isolated verification CA", ca_key, ca=True)
    server = issue(server_name, server_key, ca, ca_key)
    untrusted = issue("Untrusted verification CA", untrusted_key, ca=True)
    for name, cert in (("ca", ca), ("server", server), ("untrusted", untrusted)):
        (root / f"{name}.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (root / "server-key.pem").write_bytes(server_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))


def stop(process):
    if process is not None and process.poll() is None:
        process.terminate()
        process.wait(timeout=20)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mysql-executable", type=Path, required=True)
    parser.add_argument("--java-executable", type=Path, required=True)
    parser.add_argument("--ec-root", type=Path, default=REPO_ROOT.parent / "kusakari-ec")
    args = parser.parse_args()
    mysql = args.mysql_executable.resolve(strict=True)
    java = args.java_executable.resolve(strict=True)
    keytool = java.with_name("keytool.exe" if os.name == "nt" else "keytool")
    jar = (args.ec_root / "backend/target/kusakari-ec-api-0.1.0.jar").resolve(strict=True)
    root = Path(tempfile.mkdtemp(prefix="kusakari-db-tls-"))
    data = root / "data"
    certificates(root)
    # Container profiles must not inherit a local TLS bypass or normal DB credentials.
    env = {k: v for k, v in os.environ.items() if not k.startswith(("KUSAKARI_", "SPRING_", "AWS_"))
           and k not in {"JAVA_TOOL_OPTIONS", "OPENAI_API_KEY"}}
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    logs, owned = [], []
    database = admin = None
    verified_instance = False
    admin_password, ec_password, canvas_password = (secrets.token_urlsafe(32) for _ in range(3))
    credentials = [admin_password, ec_password, canvas_password]
    db_port, canvas_port, ec_port = free_port(), free_port(), free_port()
    if len({db_port, canvas_port, ec_port}) != 3:
        raise RuntimeError("Verification ports collided before startup.")
    report = {"result": "failed", "awsConnectionVerified": False, "linuxContainersVerified": False,
              "existingMysqlServiceModified": False, "diagnostics": str(root), "checks": []}

    def launch(command, config, label):
        log = (root / f"{label}.log").open("wb")
        logs.append(log)
        process = subprocess.Popen(command, env=config, cwd=BACKEND_ROOT, stdout=log,
                                   stderr=subprocess.STDOUT, creationflags=flags)
        owned.append(process)
        return process

    def command(command_line, config, label, accepted):
        process = launch(command_line, config, label)
        try:
            code = process.wait(timeout=90)
        except subprocess.TimeoutExpired:
            stop(process)
            raise RuntimeError(f"{label} did not terminate; inspect its preserved log.") from None
        if (code == 0) != accepted:
            raise AssertionError(f"Unexpected exit status for {label}: {code}")
        report["checks"].append({"name": label, "exitCode": code, "expectedRejection": not accepted})
        print(f"PASS: {label}", flush=True)

    def wait_api(process, port, health):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("API exited before readiness; inspect preserved diagnostics.")
            try:
                response = httpx.get(f"http://127.0.0.1:{port}{health}", timeout=2, trust_env=False)
                if response.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(.25)
        raise RuntimeError("API readiness timed out.")

    try:
        for name in ("ca", "untrusted"):
            command([str(keytool), "-importcert", "-noprompt", "-storetype", "PKCS12", "-storepass", "changeit",
                     "-keystore", str(root / f"{name}.p12"), "-alias", name, "-file", str(root / f"{name}.pem")],
                    env, f"truststore-{name}", True)
        command([str(mysql), "--no-defaults", "--initialize-insecure", f"--datadir={data}", "--console"],
                env, "mysql-initialize", True)
        database = launch([str(mysql), "--no-defaults", f"--datadir={data}", f"--port={db_port}",
                           "--bind-address=127.0.0.1", "--mysqlx=0", "--console", "--require-secure-transport=ON",
                           f"--ssl-ca={root / 'ca.pem'}", f"--ssl-cert={root / 'server.pem'}",
                           f"--ssl-key={root / 'server-key.pem'}"], env, "mysql")
        connect = {"host": "localhost", "port": db_port, "user": "root", "password": "", "autocommit": True,
                   "connect_timeout": 2, "read_timeout": 10, "ssl_ca": str(root / "ca.pem"),
                   "ssl_verify_cert": True, "ssl_verify_identity": True}
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline and database.poll() is None:
            try:
                admin = pymysql.connect(**connect)
                break
            except pymysql.MySQLError:
                time.sleep(.25)
        if admin is None:
            raise RuntimeError("Isolated TLS MySQL did not become ready.")
        with admin.cursor() as cursor:
            cursor.execute("SELECT @@datadir, @@require_secure_transport, VERSION()")
            directory, tls_required, version = cursor.fetchone()
            assert Path(directory).resolve() == data.resolve(), "Not the owned MySQL data directory"
            verified_instance = True
            assert tls_required == 1
            report["mysqlVersion"] = version
            cursor.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s", (admin_password,))
            connect["password"] = admin_password
            for schema, user, password in (("kusakari", "tls_ec", ec_password),
                                           ("kusakari_canvas", "tls_canvas", canvas_password)):
                cursor.execute(f"CREATE DATABASE {schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
                cursor.execute(f"CREATE USER '{user}'@'localhost' IDENTIFIED BY %s REQUIRE SSL", (password,))
                cursor.execute(f"GRANT ALL PRIVILEGES ON {schema}.* TO '{user}'@'localhost'")
        common = {**env, "KUSAKARI_PRIVATE_PREVIEW": "true", "KUSAKARI_PUBLIC_ORIGIN": "https://private.example.invalid"}
        canvas_env = {**common, "KUSAKARI_CANVAS_PROFILE": "container", "KUSAKARI_CANVAS_HOST": "127.0.0.1",
                      "KUSAKARI_CANVAS_PORT": str(canvas_port), "KUSAKARI_CANVAS_API_PREFIX": "/canvas",
                      "KUSAKARI_CANVAS_DB_URL": f"mysql://localhost:{db_port}/kusakari_canvas",
                      "KUSAKARI_CANVAS_DB_USER": "tls_canvas", "KUSAKARI_CANVAS_DB_PASSWORD": canvas_password,
                      "KUSAKARI_CANVAS_DB_CA": str(root / "ca.pem"), "KUSAKARI_CANVAS_BACKUP_DIR": str(root / "backups")}
        ec_env = {**common, "SPRING_PROFILES_ACTIVE": "container", "SERVER_ADDRESS": "127.0.0.1",
                  "KUSAKARI_EC_API_PORT": str(ec_port), "KUSAKARI_EC_DB_USER": "tls_ec",
                  "KUSAKARI_EC_DB_PASSWORD": ec_password,
                  "KUSAKARI_EC_DB_URL": f"jdbc:mysql://localhost:{db_port}/kusakari?connectionTimeZone=UTC",
                  "KUSAKARI_EC_DB_TRUSTSTORE_URL": (root / "ca.p12").as_uri()}
        canvas_command = [sys.executable, "-m", "kusakari_canvas_api"]
        ec_command = [str(java), "-Xms32m", "-Xmx512m", "-jar", str(jar)]
        for name, base_command, config in (("canvas", canvas_command, canvas_env), ("ec", ec_command, ec_env)):
            command(base_command + ["migrate"], config, f"{name}-migrate-trusted", True)
            command(base_command + ["migrate"], config, f"{name}-migrate-repeat", True)
        canvas_api = launch(canvas_command + ["serve"], canvas_env, "canvas-api-trusted")
        ec_api = launch(ec_command, ec_env, "ec-api-trusted")
        wait_api(canvas_api, canvas_port, "/health/ready")
        wait_api(ec_api, ec_port, "/api/health/ready")
        headers = {"Host": "private.example.invalid", "Origin": "https://private.example.invalid"}
        with httpx.Client(headers=headers, timeout=15, trust_env=False) as client:
            products = client.get(f"http://127.0.0.1:{ec_port}/api/products?storeId=1")
            assert products.status_code == 200 and products.json()
            garden = client.post(f"http://127.0.0.1:{canvas_port}/canvas/api/gardens", json={"name": "TLS fixture"})
            assert garden.status_code == 201
            fetched = client.get(f"http://127.0.0.1:{canvas_port}/canvas/api/gardens/{garden.json()['id']}")
            assert fetched.status_code == 200 and fetched.json() == garden.json()
        report["checks"].append({"name": "container-profile-api-read-write-over-required-tls", "passed": True})
        print("PASS: both container-profile APIs read/write the TLS-only database", flush=True)
        stop(canvas_api)
        stop(ec_api)
        for name, base_command, config, url_key, trust_key, untrusted in (
                ("canvas", canvas_command, canvas_env, "KUSAKARI_CANVAS_DB_URL", "KUSAKARI_CANVAS_DB_CA", str(root / "untrusted.pem")),
                ("ec", ec_command, ec_env, "KUSAKARI_EC_DB_URL", "KUSAKARI_EC_DB_TRUSTSTORE_URL", (root / "untrusted.p12").as_uri())):
            for reason, changed in (("untrusted-ca", {trust_key: untrusted}),
                                    ("wrong-hostname", {url_key: config[url_key].replace("localhost", "127.0.0.1")})):
                for action in ("migrate", "serve"):
                    args = [] if name == "ec" and action == "serve" else [action]
                    command(base_command + args, {**config, **changed}, f"{name}-{action}-{reason}", False)
            # A rejection must not merely be a stopped database or broken migration command.
            command(base_command + ["migrate"], config, f"{name}-trusted-after-rejections", True)
        report["result"] = "passed"
    finally:
        for process in reversed(owned):
            if process is not database:
                stop(process)
        if database is not None and database.poll() is None:
            if admin is not None and verified_instance:
                with admin.cursor() as cursor:
                    cursor.execute("SHUTDOWN")
                database.wait(timeout=30)
            else:
                stop(database)
        if admin is not None:
            admin.close()
        for log in logs:
            log.close()
        for path in root.glob("*.log"):
            content = path.read_text(encoding="utf-8", errors="replace")
            for secret in credentials:
                content = content.replace(secret, "[local test secret]")
            path.write_text(content, encoding="utf-8")
        report["ownedProcessesStopped"] = all(p.poll() is not None for p in owned)
        output = REPO_ROOT / "artifacts/deployment-refactor/database-tls.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
