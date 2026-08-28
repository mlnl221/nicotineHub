# ---- Bridge: Bun WebSocket + Soulseek login server ----
FROM oven/bun:1.2 AS base
WORKDIR /app

# ---- deps: workspace-aware install ----
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/bridge/package.json apps/bridge/package.json
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile

# ---- builder ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY apps/bridge apps/bridge
WORKDIR /app/apps/bridge
RUN bun run build

# ---- runtime ----
# The bundled output is self-contained (deps bundled), so no node_modules needed.
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/apps/bridge/dist ./dist
EXPOSE 8787
CMD ["bun", "run", "dist/server.js"]
