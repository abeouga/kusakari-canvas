"""Check owner isolation that cannot be exercised through the fixed-owner demo UI."""
import base64
import io
import json
from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import delete
from sqlalchemy.orm import Session

from kusakari_canvas_api.config import Settings
from kusakari_canvas_api.database import create_database_engine
from kusakari_canvas_api.main import create_app
from kusakari_canvas_api.models import Garden


def main() -> None:
    settings = Settings.from_env()
    if settings.profile != "e2e":
        raise RuntimeError("This verification requires the dedicated E2E database.")
    engine = create_database_engine(settings)
    foreign_id = str(uuid4())
    try:
        with Session(engine) as session, session.begin():
            session.add(Garden(id=foreign_id, owner_id="shopping-verification-foreign", name="非所有庭のリスト",
                               width=10, depth=8, revision=0, photo_json=None,
                               updated_at=datetime.now(UTC).replace(tzinfo=None)))
        with TestClient(create_app(settings)) as client:
            result = client.get("/api/shopping-lists")
            assert result.status_code == 200
            assert all(row["gardenId"] != foreign_id for row in result.json())
            assert client.get(f"/api/gardens/{foreign_id}/shopping-list").status_code == 404
            assert client.get(f"/api/gardens/{foreign_id}/thumbnail").status_code == 404
            image = io.BytesIO()
            Image.new("RGB", (32, 32)).save(image, format="PNG")
            data_url = "data:image/png;base64," + base64.b64encode(image.getvalue()).decode()
            assert client.post(f"/api/gardens/{foreign_id}/thumbnail",
                               json={"revision": 0, "dataUrl": data_url}).status_code == 404
            assert client.get(f"/api/gardens/{uuid4()}/shopping-list").status_code == 404
            assert client.get("/api/shopping-lists?ownerId=shopping-verification-foreign").json() == result.json()
        print(json.dumps({"result": "passed", "checks": ["owner-scoped summaries", "foreign detail 404",
                                                            "missing detail 404", "client ownerId ignored",
                                                            "foreign thumbnail read 404", "foreign thumbnail write 404"]}))
    finally:
        with Session(engine) as session, session.begin():
            session.execute(delete(Garden).where(Garden.id == foreign_id, Garden.owner_id == "shopping-verification-foreign"))
        engine.dispose()


if __name__ == "__main__":
    main()
