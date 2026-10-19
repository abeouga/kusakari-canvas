"""Exercise the real container startup against the dedicated local E2E MySQL only.

Credentials stay in this child process, never in Playwright configuration/artifacts.
This does not validate a Linux image, RDS TLS, or AWS storage.
"""
import os
import sys

from kusakari_canvas_api.__main__ import main
from kusakari_canvas_api.config import Settings

os.environ["KUSAKARI_CANVAS_PROFILE"] = "e2e"
settings = Settings.from_env()
address = settings.database_url
if address.host != "127.0.0.1" or not address.database.startswith("kusakari_canvas_e2e"):
    raise ValueError("Container verification requires dedicated loopback E2E MySQL.")
os.environ.update({
    "KUSAKARI_CANVAS_PROFILE": "container", "KUSAKARI_PRIVATE_PREVIEW": "true",
    "KUSAKARI_CANVAS_HOST": "127.0.0.1", "KUSAKARI_CANVAS_DB_TLS": "disabled",
    "KUSAKARI_CANVAS_PREVIEW_OWNER": settings.owner_id,
    "KUSAKARI_CANVAS_DB_URL": f"mysql://127.0.0.1:{address.port}/{address.database}",
    "KUSAKARI_CANVAS_DB_USER": address.username, "KUSAKARI_CANVAS_DB_PASSWORD": address.password,
    "KUSAKARI_CANVAS_MEDIA_STORAGE": "database",
    "KUSAKARI_CANVAS_EC_URL": os.environ["KUSAKARI_CANVAS_E2E_EC_URL"],
    "KUSAKARI_CANVAS_EC_IMAGE_ORIGIN": os.environ["KUSAKARI_CANVAS_E2E_EC_IMAGE_ORIGIN"],
})
sys.argv[1:] = ["serve"]
raise SystemExit(main())
