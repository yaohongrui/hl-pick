#!/usr/bin/env bash
# Rebuild safely on the small single-box deployment.
# Building with web+worker running can OOM-kill Next.js (exit 137).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[rebuild] stopping PM2 apps"
pm2 stop hl-pick-web hl-pick-worker >/dev/null 2>&1 || true

echo "[rebuild] cleaning .next"
rm -rf .next

echo "[rebuild] building"
NEXT_TELEMETRY_DISABLED=1 npm run build

echo "[rebuild] starting PM2 apps"
pm2 start ecosystem.config.cjs >/dev/null 2>&1 || pm2 restart ecosystem.config.cjs
pm2 save >/dev/null 2>&1 || true

echo "[rebuild] done"
pm2 list | grep -E 'hl-pick|name' || true
