# syntax=docker/dockerfile:1.6
# ---- Builder (Bun): Next.js standalone build ----
FROM oven/bun:1.4-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/bridge/package.json apps/bridge/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile && rm -rf node_modules/@playwright node_modules/playwright* node_modules/.bun/@playwright* node_modules/.bun/playwright* 2>/dev/null || true
COPY apps/web apps/web
WORKDIR /app/apps/web
ARG TAG
ARG BUILD_TAG
ARG COMMIT_SHA
ARG BUILD_DATE
ARG NEXT_PUBLIC_BRIDGE_URL
ARG NEXT_PUBLIC_DEMO
ENV TAG=${TAG}
ENV BUILD_TAG=${BUILD_TAG:-$TAG}
ENV COMMIT_SHA=${COMMIT_SHA}
ENV BUILD_DATE=${BUILD_DATE}
ENV NEXT_PUBLIC_BUILD_TAG=${BUILD_TAG:-$TAG}
ENV NEXT_PUBLIC_APP_VERSION=${BUILD_TAG:-$TAG}
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BUILD_DATE=${BUILD_DATE}
ENV NEXT_PUBLIC_BRIDGE_URL=${NEXT_PUBLIC_BRIDGE_URL}
ENV NEXT_PUBLIC_DEMO=${NEXT_PUBLIC_DEMO}
RUN --mount=type=cache,target=/app/apps/web/.next/cache bun run build

# ---- Runtime (Node): Next.js standalone server ----
# The standalone output preserves the monorepo layout: the server lives at
# apps/web/server.js inside the standalone tree.
FROM node:22-alpine AS runner
ARG TAG
ARG BUILD_TAG
ARG COMMIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/mlnl221/nicotineHub"
LABEL org.opencontainers.image.description="Nicotine Hub — GPL-3.0-or-later web client (based on Nicotine+)"
LABEL org.opencontainers.image.version="${BUILD_TAG:-$TAG}"
WORKDIR /app
ENV NODE_ENV=production
ENV TAG=${TAG}
ENV BUILD_TAG=${BUILD_TAG:-$TAG}
ENV NEXT_PUBLIC_BUILD_TAG=${BUILD_TAG:-$TAG}
ENV NEXT_PUBLIC_APP_VERSION=${BUILD_TAG:-$TAG}
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_BUILD_DATE=${BUILD_DATE}
COPY --from=builder /app/apps/web/.next/standalone ./
# Static assets and public files are served relative to apps/web.
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
# Same-origin entry wrapper: proxies /ws → bridge and HTTP → inner Next
# server so bridge/worker need no published host ports.
COPY --from=builder /app/apps/web/proxy-server.js ./apps/web/proxy-server.js
# Keep license visible in runtime image (context is repo root)
COPY LICENSE ./LICENSE
COPY LICENSES ./LICENSES
COPY ATTRIBUTION.md ./ATTRIBUTION.md
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
# Server-side service targets (compose network DNS — no published ports needed)
ENV BRIDGE_INTERNAL_URL=http://bridge:8787 WORKER_INTERNAL_URL=http://worker:8789
CMD ["node", "apps/web/proxy-server.js"]
