# syntax=docker/dockerfile:1.6
# ---- Bridge: Bun WebSocket + Soulseek login server ----
FROM oven/bun:1.4-alpine AS base
WORKDIR /app

# ---- deps: workspace-aware install ----
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/bridge/package.json apps/bridge/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile && rm -rf node_modules/@playwright node_modules/playwright* node_modules/.bun/@playwright* node_modules/.bun/playwright* 2>/dev/null || true

# ---- builder ----
FROM base AS builder
COPY package.json bun.lock ./
COPY apps/bridge/package.json apps/bridge/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/bridge apps/bridge
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/bridge/node_modules ./apps/bridge/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
WORKDIR /app/apps/bridge
ARG TAG
ARG BUILD_TAG
ARG COMMIT_SHA
ARG BUILD_DATE
ENV TAG=${TAG}
ENV BUILD_TAG=${BUILD_TAG:-$TAG}
ENV APP_VERSION=${BUILD_TAG:-$TAG}
ENV COMMIT_SHA=${COMMIT_SHA}
ENV BUILD_DATE=${BUILD_DATE}
RUN bun run build

# ---- runtime ----
# The bundled output is self-contained (deps bundled), so no node_modules needed.
FROM base AS runner
ARG TAG
ARG BUILD_TAG
ARG COMMIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/mlnl221/nicotineHub"
LABEL org.opencontainers.image.description="Nicotine Hub — GPL-3.0-or-later Soulseek bridge (port of Nicotine+)"
LABEL org.opencontainers.image.version="${BUILD_TAG:-$TAG}"
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV TAG=${TAG}
ENV BUILD_TAG=${BUILD_TAG:-$TAG}
ENV APP_VERSION=${BUILD_TAG:-$TAG}
ENV COMMIT_SHA=${COMMIT_SHA}
ENV BUILD_DATE=${BUILD_DATE}
WORKDIR /app
COPY --from=builder /app/apps/bridge/dist ./dist
# GeoIP: fetch at build time (not committed — see .gitignore). Fallback to empty if offline.
RUN mkdir -p ./dist/data && \
    (curl -fsSL https://raw.githubusercontent.com/nicotine-plus/nicotine-plus/master/pynicotine/external/data/ip_country_data.csv -o ./dist/data/ip_country_data.csv || \
     wget -qO ./dist/data/ip_country_data.csv https://raw.githubusercontent.com/nicotine-plus/nicotine-plus/master/pynicotine/external/data/ip_country_data.csv || \
     echo "GeoIP fetch failed — geoblock will be no-op" && rm -f ./dist/data/ip_country_data.csv)
COPY COPYING ./COPYING
COPY LICENSES ./LICENSES
COPY ATTRIBUTION.md ./ATTRIBUTION.md
# Spectrum: sox + flac + ffmpeg (aac/m4a/mp3) + oxipng (port of smoked-salmon sox spectrogram)
RUN apk add --no-cache sox flac ffmpeg oxipng && mkdir -p /tmp/hub-spectrum && chmod 777 /tmp/hub-spectrum || true
RUN mkdir -p $DATA_DIR $DATA_DIR/incomplete $DATA_DIR/downloads $DATA_DIR/uploads && chown -R bun:bun $DATA_DIR || chown -R 1000:1000 $DATA_DIR || true
# default LISTEN_PORT 60754; host mapping uses LISTEN_PORT env
EXPOSE 8787 60754
CMD ["bun", "run", "dist/server.js"]
