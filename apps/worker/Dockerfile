# syntax=docker/dockerfile:1.6
# ---- Worker: Python FastAPI for scrape/spectrum/tag/verify/analyze ----
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    SPECTRUM_DIR=/tmp/hub-spectrum
WORKDIR /app
COPY apps/worker/requirements.txt ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends sox flac ffmpeg curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /tmp/hub-spectrum && chmod 777 /tmp/hub-spectrum \
    && mkdir -p $DATA_DIR $DATA_DIR/downloads
COPY apps/worker/ ./
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.description="Nicotine Hub worker — scrape/spectrum/tag (own code)"
EXPOSE 8789
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD curl -f http://localhost:8789/health || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8789"]
