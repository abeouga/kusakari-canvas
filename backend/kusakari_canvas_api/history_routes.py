from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from . import history_service
from .history_schemas import HistoryDetail, HistoryPage, HistorySaveRequest, HistorySummary


def history_router(owner: str, get_session, media=None) -> APIRouter:
    router = APIRouter(prefix="/api/gardens/{id}/image-history", tags=["image-history"])
    Db = Annotated[Session, Depends(get_session)]

    @router.get("", response_model=HistoryPage)
    def list_items(id: str, db: Db, limit: Annotated[int, Query(ge=1, le=50)] = 20,
                   cursor: Annotated[str | None, Query(max_length=256)] = None):
        return history_service.list_history(db, owner, id, limit, cursor)

    @router.post("", response_model=HistorySummary)
    def save(id: str, request: HistorySaveRequest, db: Db):
        return history_service.save_history(db, owner, id, request, media)

    @router.get("/{historyId}", response_model=HistoryDetail)
    def get(id: str, historyId: str, db: Db):
        return history_service.get_history(db, owner, id, historyId, media)

    @router.get("/{historyId}/thumbnail")
    def thumbnail(id: str, historyId: str, db: Db):
        content = history_service.get_history_thumbnail(db, owner, id, historyId, media)
        return Response(content, media_type="image/png", headers={"Cache-Control": "private, no-cache"})

    @router.delete("/{historyId}", status_code=204)
    def delete(id: str, historyId: str, db: Db):
        history_service.delete_history(db, owner, id, historyId)
        return Response(status_code=204)

    return router
