# syntax=docker/dockerfile:1.6
# ---- Worker: Python FastAPI for scrape/spectrum/tag/verify/analyze ----
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:0.6 /uv /uvx /bin/
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    SPECTRUM_DIR=/tmp/spectrals \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app
# System layer (rarely changes — stays cached across dep bumps)
RUN apt-get update \
    && apt-get install -y --no-install-recommends sox flac ffmpeg curl mediainfo \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/spectrals && chmod 777 /tmp/spectrals \
    && mkdir -p $DATA_DIR $DATA_DIR/downloads
# Deps layer: bind-mount manifests so source edits don't invalidate it
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=apps/worker/pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=apps/worker/uv.lock,target=uv.lock \
    uv sync --locked --no-dev --no-install-project
COPY apps/worker/ ./
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.description="Nicotine Hub worker — scrape/spectrum/tag (own code)"
EXPOSE 8789
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD curl -f http://localhost:8789/health || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8789"]
