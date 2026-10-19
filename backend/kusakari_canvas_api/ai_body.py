from starlette.responses import JSONResponse

from .ai_config import MAX_BODY_BYTES


class AiBodyLimitMiddleware:
    """Bound AI requests before FastAPI buffers JSON and Pydantic parses image strings."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        bounded_path = path.endswith("/ai-image") or path.endswith("/image-history") or path.endswith("/thumbnail")
        if scope["type"] != "http" or scope.get("method") != "POST" or not bounded_path:
            await self.app(scope, receive, send)
            return
        chunks = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            size += len(body)
            limit = 460000 if path.endswith("/thumbnail") else MAX_BODY_BYTES
            if size > limit:
                response = JSONResponse(status_code=413, content={
                    "status": 413, "code": "AI_REQUEST_TOO_LARGE",
                    "message": "画像保存リクエストの容量が上限を超えています。"})
                await response(scope, receive, send)
                return
            chunks.append(body)
            if not message.get("more_body", False):
                break
        sent = False

        async def bounded_receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, bounded_receive, send)
