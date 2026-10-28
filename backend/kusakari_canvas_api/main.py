import logging
from collections.abc import Generator
from contextlib import asynccontextmanager
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, FastAPI, Query, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from starlette.exceptions import HTTPException

from . import service, shopping
from .ai_body import AiBodyLimitMiddleware
from .ai_catalog import candidates, material_code, product_references, stores
from .ai_config import MODEL, AiSettings
from .ai_schemas import (
    AiCandidate,
    AiImageRequest,
    AiImageResponse,
    AiStatus,
    AiStore,
    ProductReferencesRequest,
)
from .ai_service import generate_image
from .auth import AuthBoundary
from .calibration import solve_calibration
from .config import Settings
from .database import create_database_engine
from .errors import ApiError
from .history_routes import history_router
from .media import MediaStore
from .migrations import HEAD, current_revision, validate_schema
from .plant_assembly import assemble, part_catalog
from .plant_schemas import PlantComposition, PlantProfile
from .schemas import (
    AssetResponse,
    CalibrationRequest,
    CreateGardenRequest,
    GardenDocument,
    GardenDocumentRequest,
    GardenSummary,
    PhotoCalibration,
)
from .thumbnails import thumbnail_router


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"status": status, "code": code, "message": message})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    engine = create_database_engine(settings)
    sessions = sessionmaker(engine, expire_on_commit=False)
    media = MediaStore()
    auth = AuthBoundary(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            with engine.connect() as connection:
                validate_schema(connection, HEAD)
                if current_revision(connection) != HEAD:
                    raise ValueError("Run npm run migrate:api before starting the API directly.")
            yield
        finally:
            await auth.close()
            media.close()
            engine.dispose()

    app = FastAPI(title="Kusakari Canvas API", version="0.2.0", lifespan=lifespan, redirect_slashes=False)
    ai_settings = AiSettings.from_profile(settings.profile)
    router = APIRouter(prefix=settings.api_prefix)
    app.add_middleware(AiBodyLimitMiddleware)

    @app.get("/health/live")
    def live():
        return {"status": "ok", "application": "kusakari-canvas", "backend": "fastapi"}

    @app.get("/health/ready")
    def ready():
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return live()
        except Exception:
            return error_response(503, "NOT_READY", "データベースへ接続できません。")

    @app.middleware("http")
    async def backend_identity(request, call_next):
        if settings.public_origin:
            origin = request.headers.get("origin")
            health = request.method == "GET" and request.url.path in {"/health/live", "/health/ready"}
            allowed_hosts = {"127.0.0.1", "localhost", urlparse(settings.public_origin).hostname}
            if (origin and origin != settings.public_origin) or (not health and request.url.hostname not in allowed_hosts):
                return error_response(403, "ORIGIN_REJECTED", "許可されていない接続元です。")
        rejected = await auth.authenticate(request)
        if rejected is not None:
            return rejected
        try:
            response = await call_next(request)
        except Exception as error:
            logging.getLogger(__name__).error("API operation failed: %s", type(error).__name__)
            response = error_response(500, "INTERNAL_ERROR", "サーバーでエラーが発生しました。")
        response.headers["X-Kusakari-Canvas-Backend"] = "fastapi"
        return response

    @app.exception_handler(ApiError)
    async def domain_error(_request, error: ApiError):
        return error_response(error.status, error.code, error.message)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _error):
        return error_response(400, "INVALID_REQUEST", "リクエストの形式または値が不正です。")

    @app.exception_handler(HTTPException)
    async def http_error(_request, error: HTTPException):
        if error.status_code == 405:
            response = error_response(405, "METHOD_NOT_ALLOWED", "このHTTPメソッドは利用できません。")
        else:
            response = error_response(404, "NOT_FOUND", "要求されたリソースが見つかりません。")
        if error.headers:
            response.headers.update(error.headers)
        return response

    @app.exception_handler(IntegrityError)
    async def storage_conflict(_request, _error):
        return error_response(409, "STORAGE_CONFLICT", "保存データが競合しました。最新の庭を取得してください。")

    @app.exception_handler(Exception)
    async def unexpected_error(_request, error):
        logging.getLogger(__name__).error("API operation failed: %s", type(error).__name__)
        return error_response(500, "INTERNAL_ERROR", "サーバーでエラーが発生しました。")

    def get_session() -> Generator[Session, None, None]:
        with sessions() as session:
            yield session

    Db = Annotated[Session, Depends(get_session)]
    Owner = Annotated[str, Depends(auth.owner)]
    router.include_router(history_router(auth.owner, get_session, media))
    router.include_router(thumbnail_router(auth.owner, get_session, media))

    @router.get("/api/auth/status")
    def auth_status():
        return {"mode": auth.mode}

    @router.get("/api/ai/status", response_model=AiStatus)
    def ai_status():
        return AiStatus(configured=bool(ai_settings.api_key), model=MODEL, quality=ai_settings.quality)

    @router.get("/api/ai/stores", response_model=list[AiStore])
    def ai_stores():
        return stores(ai_settings)

    @router.get("/api/ai/candidates", response_model=list[AiCandidate])
    def ai_candidates(db: Db, storeId: Annotated[int, Query(gt=0)],
                      assetId: Annotated[str, Query(min_length=1, max_length=64)]):
        # Only serve known, supported plant assets; release the DB read before EC I/O.
        service.require_asset(db, assetId)
        material_code(assetId)
        return candidates(ai_settings, storeId, assetId)

    @router.post("/api/gardens/{id}/ai-image", response_model=AiImageResponse)
    def ai_image(id: str, request: AiImageRequest, db: Db, owner: Owner):
        return generate_image(db, ai_settings, owner, id, request)

    @router.post("/api/ai/product-references", response_model=list[AiCandidate])
    def automatic_references(request: ProductReferencesRequest):
        return product_references(ai_settings, request.productIds)

    @router.post("/api/photo-calibration", response_model=PhotoCalibration)
    def calibrate(request: CalibrationRequest):
        return solve_calibration(request)

    @router.get("/api/assets", response_model=list[AssetResponse])
    def assets(db: Db):
        return service.list_assets(db)

    @router.get("/api/model-parts")
    def model_parts():
        return part_catalog()

    @router.post("/api/model-assemblies/resolve", response_model=PlantComposition)
    def resolve_model(profile: PlantProfile, version: int = 4):
        try:
            return assemble(profile, version)
        except ValueError as error:
            from .errors import bad_request
            bad_request("INCOMPATIBLE_PLANT_DIMENSIONS", str(error))

    @router.get("/api/shopping-lists", response_model=list[shopping.ShoppingSummary])
    def shopping_lists(db: Db, owner: Owner):
        return shopping.summaries(db, owner)

    @router.get("/api/gardens/{id}/shopping-list", response_model=shopping.ShoppingList)
    def shopping_list(id: str, db: Db, owner: Owner):
        return shopping.detail(db, owner, id)

    @router.get("/api/gardens", response_model=list[GardenSummary])
    def gardens(db: Db, owner: Owner):
        return service.list_gardens(db, owner)

    @router.post("/api/gardens", status_code=201, response_model=GardenDocument)
    def create(request: CreateGardenRequest, response: Response, db: Db, owner: Owner):
        garden = service.create_garden(db, owner, request)
        response.headers["Location"] = f"{settings.api_prefix}/api/gardens/{garden.id}"
        return garden

    @router.post("/api/gardens/{id}/duplicate", status_code=201, response_model=GardenSummary)
    def duplicate(id: str, response: Response, db: Db, owner: Owner):
        garden = service.duplicate_garden(db, owner, id)
        response.headers["Location"] = f"{settings.api_prefix}/api/gardens/{garden.id}"
        return garden

    @router.get("/api/gardens/{id}", response_model=GardenDocument)
    def get(id: str, db: Db, owner: Owner):
        return service.get_garden(db, owner, id, media)

    @router.put("/api/gardens/{id}", response_model=GardenDocument)
    def update(id: str, request: GardenDocumentRequest, db: Db, owner: Owner):
        return service.update_garden(db, owner, id, request, media)

    @router.delete("/api/gardens/{id}", status_code=204)
    def delete(id: str, db: Db, owner: Owner):
        service.delete_garden(db, owner, id)
        return Response(status_code=204)

    app.include_router(router)
    return app
