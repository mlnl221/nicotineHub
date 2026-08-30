# ---- Builder (Bun): Next.js standalone build ----
FROM oven/bun:1.4 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/bridge/package.json apps/bridge/package.json
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile && rm -rf node_modules/@playwright node_modules/playwright* node_modules/.bun/@playwright* node_modules/.bun/playwright* 2>/dev/null || true
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN bun run build

# ---- Runtime (Node): Next.js standalone server ----
# The standalone output preserves the monorepo layout: the server lives at
# apps/web/server.js inside the standalone tree.
FROM node:22-alpine AS runner
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.source="https://github.com/mlnl221/nicotineHub"
LABEL org.opencontainers.image.description="Nicotine Hub — GPL-3.0-or-later web client (based on Nicotine+)"
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
# Static assets and public files are served relative to apps/web.
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
# Keep license visible in runtime image (context is repo root)
COPY COPYING ./COPYING
COPY LICENSES ./LICENSES
COPY ATTRIBUTION.md ./ATTRIBUTION.md
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
