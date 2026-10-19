import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import URL

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent


def canvas_data_home() -> Path:
    configured = os.environ.get("KUSAKARI_CANVAS_HOME")
    if configured and configured.strip():
        expanded = Path(os.path.expandvars(configured.strip())).expanduser()
        if not expanded.is_absolute():
            expanded = REPO_ROOT / expanded
        return expanded.resolve()
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
        return base / "KusakariCanvas"
    data_home = os.environ.get("XDG_DATA_HOME")
    base = Path(data_home).expanduser() if data_home else Path.home() / ".local" / "share"
    return base / "kusakari-canvas"


def load_local_settings(profile: str) -> None:
    prefix = "KUSAKARI_CANVAS_E2E_DB_" if profile == "e2e" else "KUSAKARI_CANVAS_DB_"
    path = REPO_ROOT / (".env.e2e" if profile == "e2e" else ".env")
    if not path.is_file():
        return
    allowed = {prefix + suffix for suffix in ("USER", "PASSWORD", "URL")}
    if profile == "e2e":
        allowed.update({"KUSAKARI_CANVAS_E2E_OPENAI_API_KEY", "KUSAKARI_CANVAS_E2E_EC_URL"})
    else:
        allowed.update({"OPENAI_API_KEY", "KUSAKARI_CANVAS_EC_URL"})
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and key.strip() in allowed:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            if not os.environ.get(key.strip()):
                os.environ[key.strip()] = value


@dataclass(frozen=True)
class Settings:
    profile: str
    host: str
    port: int
    database_url: URL
    backup_dir: Path
    api_prefix: str = ""
    db_ca: str | None = None
    pool_size: int = 5
    preview_owner: str = "kusakari-canvas-private-preview"
    public_origin: str | None = None

    @property
    def owner_id(self) -> str:
        if self.profile == "container":
            return self.preview_owner
        return "kusakari-canvas-e2e-demo" if self.profile == "e2e" else "kusakari-canvas-local-demo"

    @classmethod
    def from_env(cls) -> "Settings":
        profile = os.environ.get("KUSAKARI_CANVAS_PROFILE", "dev")
        if profile not in {"dev", "e2e", "container"}:
            raise ValueError("KUSAKARI_CANVAS_PROFILE must be dev, e2e or container.")
        container = profile == "container"
        if container and os.environ.get("KUSAKARI_PRIVATE_PREVIEW") != "true":
            raise ValueError("Container mode requires KUSAKARI_PRIVATE_PREVIEW=true and a private access boundary.")
        if not container:
            load_local_settings(profile)
        host = os.environ.get("KUSAKARI_CANVAS_HOST", "0.0.0.0" if container else "127.0.0.1")
        if not container and host != "127.0.0.1":
            raise ValueError("Local demo API must bind to 127.0.0.1.")
        prefix = "KUSAKARI_CANVAS_E2E_DB_" if profile == "e2e" else "KUSAKARI_CANVAS_DB_"
        user, password = (os.environ.get(prefix + suffix, "") for suffix in ("USER", "PASSWORD"))
        if not user or not password:
            raise ValueError(f"{prefix}USER and {prefix}PASSWORD must be configured.")
        default_db = "kusakari_canvas_e2e" if profile == "e2e" else "kusakari_canvas"
        address = os.environ.get(prefix + "URL", f"mysql://127.0.0.1:3306/{default_db}")
        parsed = urlparse(address.removeprefix("jdbc:"))
        if parsed.scheme not in {"mysql", "mysql+pymysql"} or not parsed.hostname:
            raise ValueError(f"{prefix}URL must be a MySQL URL.")
        database = parsed.path.lstrip("/")
        if not database or "/" in database:
            raise ValueError("MySQL database name is missing or invalid.")
        if profile == "e2e" and not database.startswith("kusakari_canvas_e2e"):
            raise ValueError("E2E requires a dedicated kusakari_canvas_e2e* database.")
        if profile == "dev" and database != "kusakari_canvas":
            raise ValueError("The dev profile requires the kusakari_canvas database.")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Use separate DB_USER/DB_PASSWORD and a host/port/database URL without query parameters.")
        url = URL.create("mysql+pymysql", username=user, password=password, host=parsed.hostname,
                         port=parsed.port or 3306, database=database, query={"charset": "utf8mb4"})
        configured_backup_dir = os.environ.get("KUSAKARI_CANVAS_BACKUP_DIR")
        if configured_backup_dir and configured_backup_dir.strip():
            backup_dir = Path(os.path.expandvars(configured_backup_dir.strip())).expanduser()
            if not backup_dir.is_absolute():
                backup_dir = REPO_ROOT / backup_dir
            backup_dir = backup_dir.resolve()
        else:
            backup_dir = canvas_data_home() / "backups"
        port = int(os.environ.get("KUSAKARI_CANVAS_PORT", "8080"))
        if not 1 <= port <= 65535:
            raise ValueError("KUSAKARI_CANVAS_PORT must be between 1 and 65535.")
        api_prefix = os.environ.get("KUSAKARI_CANVAS_API_PREFIX", "")
        if api_prefix not in {"", "/canvas"}:
            raise ValueError("KUSAKARI_CANVAS_API_PREFIX must be empty or /canvas.")
        tls = os.environ.get("KUSAKARI_CANVAS_DB_TLS", "verify_identity" if container else "disabled")
        if tls not in {"disabled", "verify_identity"}:
            raise ValueError("KUSAKARI_CANVAS_DB_TLS must be disabled or verify_identity.")
        ca = os.environ.get("KUSAKARI_CANVAS_DB_CA", "/app/certs/rds-global-bundle.pem") if tls == "verify_identity" else None
        if ca and not Path(ca).is_file():
            raise ValueError("The configured DB CA certificate does not exist.")
        pool_size = int(os.environ.get("KUSAKARI_CANVAS_DB_POOL_SIZE", "5"))
        if not 1 <= pool_size <= 32:
            raise ValueError("DB pool size must be between 1 and 32.")
        owner = os.environ.get("KUSAKARI_CANVAS_PREVIEW_OWNER", "kusakari-canvas-private-preview")
        if not owner.strip() or len(owner) > 128:
            raise ValueError("Preview owner must be a nonempty server-side identifier of at most 128 characters.")
        public_origin = os.environ.get("KUSAKARI_PUBLIC_ORIGIN") if container else None
        if container:
            public = urlparse(public_origin or "")
            if (public.scheme not in {"http", "https"} or not public.hostname or public.path
                    or public.username or public.password or public.query or public.fragment):
                raise ValueError("KUSAKARI_PUBLIC_ORIGIN must be an HTTP(S) origin without path or credentials.")
        return cls(profile, host, port, url, backup_dir, api_prefix, ca, pool_size, owner, public_origin)
