# nicotine-hub — Bun workspaces (apps/bridge + apps/web)
# Usage:
#   make install            # bun install
#   make dev                # web:3000 bridge:8787 LISTEN 62904 (prompt if TTY)
#   make dev OFFSET=3       # web:3003 bridge:8790 LISTEN 62907  (no collision)
#   make dev LISTEN_PORT=49127
#   make dev OFFSET=3 LISTEN_PORT=49127
#   make build              # typecheck + prod builds (stop dev first)
#   make test               # bridge unit tests
#   make typecheck          # tsc --noEmit both apps
#   make verify             # typecheck + test + build
#   make build-docker       # docker compose build
#   make run-docker         # docker compose up --build -d + health check
#   make clean              # rm .next/dist (keep node_modules)
#   make distclean          # clean + rm node_modules

BUN ?= bun
DC  ?= docker compose
OFFSET ?=
LISTEN_PORT ?=
TAG ?= latest
BRIDGE_TOKEN ?=
NEXT_PUBLIC_BRIDGE_URL ?=
NEXT_PUBLIC_DEMO ?=

.PHONY: help clean distclean install build dev run typecheck test verify build-docker run-docker logs down

help: ## show targets
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?##"}{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}'

clean: ## remove build artifacts (keep node_modules)
	@if ss -tln 2>/dev/null | grep -qE ':300[0-9] |:878[0-9] '; then echo "⚠ dev ports still listening — stop 'bun run dev' first or .next corrupts (mistakes.md:74)"; fi
	rm -rf apps/web/.next apps/bridge/dist
	rm -rf /tmp/hub-spectrum* /tmp/nicotine-transfers-test-*
	@echo "clean done"

distclean: clean ## clean + node_modules
	rm -rf node_modules apps/web/node_modules apps/bridge/node_modules
	@echo "distclean done — run 'make install'"

install: ## bun install
	$(BUN) install

typecheck: ## tsc --noEmit both apps
	$(BUN) run typecheck

test: ## bun test (bridge unit, e2e excluded via bunfig.toml)
	$(BUN) test

build: ## prod builds (stop dev first — else .next corrupts)
	@if ss -tln 2>/dev/null | grep -qE ':300[0-9] |:878[0-9] '; then echo "⚠ dev ports still listening — stop 'bun run dev' first or .next corrupts (mistakes.md:74)"; fi
	$(BUN) run build

verify: typecheck test build ## typecheck + test + build

# dev: offset + listen port mirror scripts/dev.mjs:30 (PORT 3000/8787 LISTEN 62904)
# ponytail: reuse dev.mjs, no duplicate port logic
dev: ## run bridge+web (OFFSET=3 LISTEN_PORT=49127)
	$(BUN) run dev $(if $(OFFSET),$(OFFSET)) $(if $(LISTEN_PORT),$(LISTEN_PORT))

run: dev ## alias for dev

build-docker: ## docker compose build
	TAG=$(TAG) BRIDGE_TOKEN=$(BRIDGE_TOKEN) NEXT_PUBLIC_BRIDGE_URL=$(NEXT_PUBLIC_BRIDGE_URL) NEXT_PUBLIC_DEMO=$(NEXT_PUBLIC_DEMO) $(DC) build

run-docker: ## docker compose up --build -d + health check
	TAG=$(TAG) BRIDGE_TOKEN=$(BRIDGE_TOKEN) NEXT_PUBLIC_BRIDGE_URL=$(NEXT_PUBLIC_BRIDGE_URL) NEXT_PUBLIC_DEMO=$(NEXT_PUBLIC_DEMO) $(DC) up --build -d
	@echo "waiting for health..."
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		if curl -sf http://localhost:8788/health >/dev/null 2>&1 && curl -sf http://localhost:3001 >/dev/null 2>&1; then echo "✓ up: http://localhost:3001 + http://localhost:8788/health"; break; fi; \
		echo "  ...$$i/10"; sleep 2; \
	done; $(DC) ps

logs: ## docker logs -f
	$(DC) logs -f

down: ## docker compose down -v
	$(DC) down -v
