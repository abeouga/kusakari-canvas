"""Use the EC's verified server session; never accept an owner from the browser."""
import os
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse


class AuthBoundary:
    def __init__(self, settings):
        self.settings = settings
        self.mode = os.environ.get("KUSAKARI_AUTH_MODE", "demo")
        if self.mode not in {"demo", "cognito"}:
            raise ValueError("KUSAKARI_AUTH_MODE must be demo or cognito.")
        self.origin = os.environ.get("KUSAKARI_CANVAS_AUTH_EC_URL", "http://127.0.0.1:8086").rstrip("/")
        parsed = urlparse(self.origin)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment
                or (parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost"})):
            raise ValueError("Auth EC URL must be a trusted HTTPS origin or a loopback HTTP origin.")
        self.client = httpx.AsyncClient(timeout=5, follow_redirects=False, trust_env=False)

    async def close(self):
        await self.client.aclose()

    @staticmethod
    def error(status, code, message):
        return JSONResponse(status_code=status, content={"status": status, "code": code, "message": message},
                            headers={"Cache-Control": "no-store"})

    async def authenticate(self, request: Request):
        if self.mode == "demo":
            request.state.owner_id = self.settings.owner_id
            return None
        path = request.url.path.removeprefix(self.settings.api_prefix)
        if request.method == "GET" and (path.startswith("/health/") or path in {"/api/assets", "/api/model-parts", "/api/auth/status"}):
            return None
        cookie = request.cookies.get("KUSAKARI_SESSION")
        if not cookie or len(cookie) > 256 or any(c in cookie for c in "\r\n;,"):
            return self.error(401, "LOGIN_REQUIRED", "ログインしてください。")
        write = request.method not in {"GET", "HEAD", "OPTIONS"}
        headers = {"Cookie": f"KUSAKARI_SESSION={cookie}"}
        if write:
            csrf = request.headers.get("X-CSRF-TOKEN", "")
            if not csrf:
                return self.error(403, "CSRF_REQUIRED", "操作の確認情報がありません。画面を再読み込みしてください。")
            headers["X-CSRF-TOKEN"] = csrf
        try:
            response = await self.client.request("POST" if write else "GET",
                self.origin + ("/api/auth/verify" if write else "/api/auth/me"), headers=headers)
            if response.status_code in {401, 403}:
                return self.error(response.status_code, "LOGIN_REQUIRED" if response.status_code == 401 else "FORBIDDEN",
                                  "ログインまたは操作の確認情報を確認してください。")
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Invalid auth response.")
            if data.get("mode") != "cognito" or data.get("authenticated") is not True:
                return self.error(401, "LOGIN_REQUIRED", "ログインしてください。")
            request.state.owner_id = str(UUID(data["id"]))
            return None
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return self.error(503, "AUTH_UNAVAILABLE", "認証を確認できません。時間をおいて再試行してください。")

    def owner(self, request: Request) -> str:
        return request.state.owner_id
