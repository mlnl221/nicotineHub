#!/usr/bin/env bash
# Watches CONFIG_DIR/listen_port (or config volume) and syncs host .env + recreates bridge
# For users who keep bridge network (ports mapping) instead of network_mode: host.
# With host mode (compose.override.example.yaml) this script is NOT needed – Save hot-swaps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="${CONFIG_DIR:-${DATA_DIR:-}}"
if [ -z "$CONFIG_DIR" ]; then
  CONFIG_DIR="/var/lib/docker/volumes/nicotine_mobile_config/_data"
  # fallback to old bridge-data for migration
  if [ ! -f "$CONFIG_DIR/listen_port" ]; then
    OLD="/var/lib/docker/volumes/nicotine_mobile_bridge-data/_data"
    if [ -f "$OLD/listen_port" ]; then CONFIG_DIR="$OLD"; fi
  fi
fi
# Try to auto-detect volume mountpoint if CONFIG_DIR not set and we're in project dir with ./config bind
if [ ! -f "$ROOT/.env" ] && [ -f "$ROOT/compose.yaml" ]; then
  # fallback: try named volume inspect (new + old)
  if command -v docker >/dev/null 2>&1; then
    VOL="$(docker volume inspect nicotine_mobile_config --format '{{.Mountpoint}}' 2>/dev/null || docker volume inspect nicotine_mobile-config_config --format '{{.Mountpoint}}' 2>/dev/null || docker volume inspect nicotine_mobile_bridge-data --format '{{.Mountpoint}}' 2>/dev/null || echo "")"
    if [ -n "$VOL" ] && [ -f "$VOL/listen_port" ]; then
      CONFIG_DIR="$VOL"
    elif [ -d "$ROOT/config" ]; then
      CONFIG_DIR="$ROOT/config"
    elif [ -d "$ROOT/data" ]; then
      CONFIG_DIR="$ROOT/data"
    fi
  fi
fi
LISTEN_FILE="$CONFIG_DIR/listen_port"
ENV_FILE="$ROOT/.env"

echo "[sync] watching $LISTEN_FILE → $ENV_FILE (CONFIG_DIR=$CONFIG_DIR)"
mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE" 2>/dev/null || true

sync_once() {
  if [ ! -f "$LISTEN_FILE" ]; then return; fi
  PORT="$(tr -d ' \n\r' < "$LISTEN_FILE" | head -c 10)"
  if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
    echo "[sync] invalid port in $LISTEN_FILE: $PORT"
    return
  fi
  # Update .env
  if grep -q "^LISTEN_PORT=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s/^LISTEN_PORT=.*/LISTEN_PORT=$PORT/" "$ENV_FILE"
  else
    echo "LISTEN_PORT=$PORT" >> "$ENV_FILE"
  fi
  # Also ensure host.env (written by bridge) is in sync – not needed but keep
  echo "[sync] LISTEN_PORT=$PORT → $ENV_FILE, recreating bridge if needed"
  CURRENT="$(grep "^LISTEN_PORT=" "$ENV_FILE" | cut -d= -f2)"
  # Only recreate if compose would use different mapping (check docker port)
  if docker compose -f "$ROOT/compose.yaml" config 2>/dev/null | grep -q "$PORT:$PORT"; then
    # Already desired – check running container port
    RUN_PORT="$(docker port "$(docker compose -f "$ROOT/compose.yaml" ps -q bridge 2>/dev/null | head -n1)" 2>/dev/null | grep "$PORT" || true)"
    if [ -n "$RUN_PORT" ]; then
      echo "[sync] bridge already on $PORT – no recreate needed"
      return
    fi
  fi
  (cd "$ROOT" && docker compose up -d bridge) || echo "[sync] docker compose up -d failed – run manually: LISTEN_PORT=$PORT docker compose up -d bridge"
}

# initial sync
sync_once

if command -v inotifywait >/dev/null 2>&1; then
  echo "[sync] inotifywait watching $LISTEN_FILE"
  while inotifywait -e close_write,create,move "$CONFIG_DIR" 2>/dev/null; do
    sleep 0.5
    sync_once
  done
else
  echo "[sync] inotifywait not found, polling every 5s (install inotify-tools for instant)"
  while true; do sleep 5; sync_once; done
fi
