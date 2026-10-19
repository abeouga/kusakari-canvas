FROM ghcr.io/astral-sh/uv:0.12.23 AS uv
FROM python:3.12-slim-bookworm AS build
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --python /usr/local/bin/python

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && mkdir -p /app/certs \
    && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/rds-global-bundle.pem \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin canvas
WORKDIR /app/backend
COPY --from=build /app/backend/.venv /app/backend/.venv
COPY backend/kusakari_canvas_api ./kusakari_canvas_api
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY frontend/public/models/plant-parts /app/frontend/public/models/plant-parts
RUN chown 10001:10001 /tmp && chmod 0700 /tmp
VOLUME ["/tmp"]
ENV PATH="/app/backend/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    KUSAKARI_CANVAS_PROFILE=container KUSAKARI_CANVAS_API_PREFIX=/canvas
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["python", "-m", "kusakari_canvas_api"]
CMD ["serve"]
