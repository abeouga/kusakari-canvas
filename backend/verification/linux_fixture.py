"""Owned Docker fixtures for Linux deployment verification; never adopts existing data."""
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import boto3
import httpx
import pymysql
from botocore.config import Config

from verification.verify_database_tls import certificates, free_port

LABEL = "jp.kusakari.deployment-verification"


class LinuxFixture:
    def __init__(self, images, work_root=None):
        base = Path(work_root if work_root is not None else tempfile.gettempdir()).resolve(strict=True)
        if not base.is_dir() or "," in str(base):
            raise ValueError("Verification storage must be an existing directory without commas in its path")
        drives = {"verification storage": base}
        # TEMP/TMP may point to another drive; Windows and Docker Desktop still need system-drive headroom.
        drives["system drive"] = Path(os.environ["SystemRoot"]).anchor if os.name == "nt" else Path("/")
        insufficient = []
        for name, path in drives.items():
            free = shutil.disk_usage(path).free / 1024 ** 3
            if free < 5:
                insufficient.append(f"{name} ({path}): {free:.2f} GiB free")
        if insufficient:
            raise RuntimeError("Verification requires at least 5 GiB free on each checked drive: "
                               + "; ".join(insufficient)
                               + ". Also check Docker Desktop's data drive; no fixtures were created.")
        self.images = images
        self.id = "kusakari-verify-" + uuid4().hex[:12]
        self.external_storage = work_root is not None
        self.root = Path(tempfile.mkdtemp(prefix=self.id + "-", dir=base))
        self.host_data = {}
        self.owned = []
        self.volumes = []
        self.passwords = {role: secrets.token_urlsafe(32) for role in ("root", "ec", "canvas", "s3")}
        self.ports = {name: free_port() for name in ("db", "s3", "ec", "canvas", "web")}
        assert len(set(self.ports.values())) == 5, "Verification ports collided"
        self.origin = f"http://127.0.0.1:{self.ports['web']}"
        self.network = self.id + "-network"
        self.bucket = "kusakari-linux-verification"
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("KUSAKARI_", "SPRING_", "AWS_"))
                    and k not in {"JAVA_TOOL_OPTIONS", "OPENAI_API_KEY"}}
        if self.external_storage:
            temporary = self.root / "host-tmp"
            temporary.mkdir()
            self.env.update({name: str(temporary) for name in ("TEMP", "TMP", "TMPDIR")})

    def redact(self, value):
        for secret in self.passwords.values():
            value = value.replace(secret, "[local test secret]")
        return value

    def docker(self, *arguments, timeout=120):
        result = subprocess.run(["docker", *map(str, arguments)], capture_output=True, encoding="utf-8",
                                errors="replace", timeout=timeout, env=self.env,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode:
            raise RuntimeError("Docker command failed: " + self.redact(result.stderr[-3000:]))
        return result.stdout.strip()

    def inspect(self, name):
        return json.loads(self.docker("inspect", name))[0]

    def environment_file(self, name, values):
        path = self.root / f"{name}.env"
        path.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")
        return path

    def volume(self, suffix):
        name = self.id + "-" + suffix
        self.docker("volume", "create", "--label", f"{LABEL}={self.id}", name)
        self.volumes.append(name)
        return name

    def data_mount(self, suffix, destination):
        if not self.external_storage:
            return ["--mount", f"type=volume,src={self.volume(suffix)},dst={destination}"]
        # Only new fixture data moves to the selected drive; existing Docker data is never adopted.
        path = self.root / "data" / suffix
        path.mkdir(parents=True, exist_ok=False)
        self.host_data[suffix] = str(path)
        return ["--mount", f"type=bind,src={path},dst={destination}"]

    def container(self, suffix, image, options=(), command=()):
        name = self.id + "-" + suffix
        self.docker("create", "--name", name, "--label", f"{LABEL}={self.id}", *options, image, *command)
        self.owned.append(name)
        self.docker("start", name)
        return name

    def wait(self, name, probe, timeout=120):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = self.inspect(name)["State"]
            if not state["Running"]:
                raise RuntimeError(f"{name} stopped before readiness (exit {state['ExitCode']})")
            try:
                if probe():
                    return
            except Exception:
                pass
            time.sleep(.5)
        raise RuntimeError(f"{name} did not become ready")

    def wait_exit(self, name, expected_code=0):
        code = int(self.docker("wait", name, timeout=150))
        state = self.inspect(name)["State"]
        assert code == expected_code and not state["OOMKilled"], f"{name}: unexpected exit {code}"
        return code

    def db(self, schema=None):
        return pymysql.connect(host="127.0.0.1", port=self.ports["db"], user="root",
                               password=self.passwords["root"], database=schema, autocommit=True,
                               ssl_ca=str(self.root / "ca.pem"), ssl_verify_cert=True, ssl_verify_identity=True,
                               connect_timeout=3, read_timeout=10, write_timeout=10)

    def prepare(self):
        for image in self.images.values():
            assert self.inspect_image(image)["Os"] == "linux"
        certificates(self.root, "database", include_loopback=True)
        self.docker("network", "create", "--label", f"{LABEL}={self.id}", self.network)
        init = self.root / "init.sql"
        statements = []
        for role, schema in (("ec", "kusakari_e2e"), ("canvas", "kusakari_canvas_e2e")):
            statements += [f"CREATE DATABASE {schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;",
                           f"CREATE USER 'verify_{role}'@'%' IDENTIFIED BY '{self.passwords[role]}' REQUIRE SSL;",
                           f"GRANT ALL PRIVILEGES ON {schema}.* TO 'verify_{role}'@'%';"]
        init.write_text("\n".join(statements), encoding="utf-8")
        db_env = self.environment_file("mysql", {"MYSQL_ROOT_PASSWORD": self.passwords["root"], "MYSQL_ROOT_HOST": "%"})
        self.database = self.container("database", self.images["mysql"], [
            "--memory", "768m", "--cpus", "1",
            "--network", self.network, "--network-alias", "database", "--env-file", db_env,
            "-p", f"127.0.0.1:{self.ports['db']}:3306", *self.data_mount("mysql-data", "/var/lib/mysql"),
            "--mount", f"type=bind,src={self.root},dst=/verification,readonly",
            "--mount", f"type=bind,src={init},dst=/docker-entrypoint-initdb.d/01-verification.sql,readonly"], [
                "--max-connections=50", "--innodb-buffer-pool-size=64M", "--performance-schema=OFF",
                "--require-secure-transport=ON", "--ssl-ca=/verification/ca.pem",
                "--ssl-cert=/verification/server.pem", "--ssl-key=/verification/server-key.pem"])

        def database_ready():
            with self.db() as db, db.cursor() as cursor:
                cursor.execute("SELECT @@require_secure_transport")
                assert cursor.fetchone()[0] == 1
                cursor.execute("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='kusakari_canvas_e2e'")
                return cursor.fetchone()[0] == 1
        self.wait(self.database, database_ready)
        storage_env = self.environment_file("storage", {
            "AWS_ACCESS_KEY_ID": "local-verification", "AWS_SECRET_ACCESS_KEY": self.passwords["s3"],
            "S3_BUCKET": self.bucket, "GOMEMLIMIT": "256MiB"})
        self.storage = self.container("storage", self.images["storage"], [
            "--memory", "384m", "--cpus", "1",
            "--network", self.network, "--network-alias", "storage", "--env-file", storage_env,
            "-p", f"127.0.0.1:{self.ports['s3']}:8333", *self.data_mount("s3-data", "/data")], [
                "mini", "-dir=/data", "-ip=storage", "-ip.bind=0.0.0.0", "-master.telemetry=false",
                "-admin.ui=false", "-webdav=false", "-s3.port.iceberg=0", "-s3.port.lance=0",
                "-master.volumeSizeLimitMB=64", "-volume.max=4", "-s3.autoCreateBucket=false"])
        self.s3 = boto3.client("s3", endpoint_url=f"http://127.0.0.1:{self.ports['s3']}", region_name="us-east-1",
                               aws_access_key_id="local-verification", aws_secret_access_key=self.passwords["s3"],
                               config=Config(connect_timeout=2, read_timeout=5, retries={"max_attempts": 0},
                                             s3={"addressing_style": "path"}))
        self.wait(self.storage, lambda: self.s3.head_bucket(Bucket=self.bucket)["ResponseMetadata"]["HTTPStatusCode"] == 200)
        # Trust-store creation uses the exact Java runtime shipped in the EC image.
        trust = self.container("trust-store", self.images["ec"], [
            "--network", "none", "--entrypoint", "keytool", "--mount", f"type=bind,src={self.root},dst=/verification"], [
                "-importcert", "-noprompt", "-storetype", "PKCS12", "-storepass", "changeit",
                "-alias", "fixture-ca", "-file", "/verification/ca.pem", "-keystore", "/verification/ca.p12"])
        self.wait_exit(trust)
        common = {"KUSAKARI_PRIVATE_PREVIEW": "true", "KUSAKARI_PUBLIC_ORIGIN": self.origin}
        self.api_env = {
            "canvas": {**common, "KUSAKARI_CANVAS_DB_URL": "mysql://database:3306/kusakari_canvas_e2e",
                       "KUSAKARI_CANVAS_DB_USER": "verify_canvas", "KUSAKARI_CANVAS_DB_PASSWORD": self.passwords["canvas"],
                       "KUSAKARI_CANVAS_DB_CA": "/verification/ca.pem", "KUSAKARI_CANVAS_MEDIA_STORAGE": "s3",
                       "KUSAKARI_CANVAS_MEDIA_BUCKET": self.bucket, "KUSAKARI_CANVAS_S3_ENDPOINT": "http://storage:8333",
                       "AWS_ACCESS_KEY_ID": "local-verification", "AWS_SECRET_ACCESS_KEY": self.passwords["s3"],
                       "AWS_DEFAULT_REGION": "us-east-1", "AWS_EC2_METADATA_DISABLED": "true",
                       "KUSAKARI_CANVAS_EC_URL": "http://127.0.0.1:8086",
                       "KUSAKARI_CANVAS_EC_IMAGE_ORIGIN": self.origin},
            "ec": {**common, "SPRING_PROFILES_ACTIVE": "container", "KUSAKARI_EC_SECURE_COOKIE": "false",
                   "KUSAKARI_EC_DB_URL": "jdbc:mysql://database:3306/kusakari_e2e?connectionTimeZone=UTC",
                   "KUSAKARI_EC_DB_USER": "verify_ec", "KUSAKARI_EC_DB_PASSWORD": self.passwords["ec"],
                   "KUSAKARI_EC_DB_TRUSTSTORE_URL": "file:/verification/ca.p12",
                   "JAVA_TOOL_OPTIONS": "-Xms64m -Xmx512m -XX:+ExitOnOutOfMemoryError"}}

    def inspect_image(self, image):
        return json.loads(self.docker("image", "inspect", image))[0]

    def api(self, role, suffix, command=(), network=None, ports=False):
        options = ["--network", network or self.network, "--read-only", "--user", "10001:10001",
                   "--memory", "1536m" if role == "canvas" else "2560m", "--cpus", "1",
                   "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
                   "--env-file", self.environment_file(suffix, self.api_env[role]),
                   "--mount", f"type=bind,src={self.root},dst=/verification,readonly",
                   "--mount", f"type=volume,src={self.volume(suffix + '-tmp')},dst=/tmp"]
        if ports:
            options += ["-p", f"127.0.0.1:{self.ports['canvas']}:8080", "-p", f"127.0.0.1:{self.ports['ec']}:8086"]
        return self.container(suffix, self.images[role], options, command)

    def api_ready(self, role, name):
        path = "/health/ready" if role == "canvas" else "/api/health/ready"
        self.wait(name, lambda: httpx.get(f"http://127.0.0.1:{self.ports[role]}{path}", timeout=3, trust_env=False).status_code == 200)

    def stop(self, name):
        detail = self.inspect(name)
        assert detail["Config"]["Labels"].get(LABEL) == self.id, "Container ownership mismatch"
        if detail["State"]["Running"]:
            self.docker("stop", "--time", "60", name, timeout=70)
        return self.inspect(name)["State"]

    def close(self):
        failures = []
        for name in reversed(self.owned):
            try:
                self.stop(name)
                # Docker logs may send application stderr separately; retrieve both without printing secrets.
                result = subprocess.run(["docker", "logs", name], capture_output=True, encoding="utf-8", errors="replace",
                                        timeout=15, env=self.env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if result.returncode:
                    raise RuntimeError("Could not collect owned container logs")
                (self.root / f"{name}.log").write_text(self.redact(result.stdout + "\n" + result.stderr), encoding="utf-8")
            except Exception as error:
                failures.append({"container": name, "error": self.redact(str(error))})
        if hasattr(self, "s3"):
            self.s3.close()
        return failures
