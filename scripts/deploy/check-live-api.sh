#!/usr/bin/env bash
set -euo pipefail

LIVE_URL="${LIVE_URL:-https://api.coziyoo.com/v1/health/}"
ADMIN_URL="${ADMIN_URL:-https://admin.coziyoo.com/admin/}"
LOCAL_URL="${LOCAL_URL:-http://127.0.0.1:9000/v1/health/}"
AGENT_LABEL="${AGENT_LABEL:-com.coziyoo.cloudflared}"

echo "==> Local Django health"
curl -fsS --max-time 10 "${LOCAL_URL}"
echo

echo "==> Cloudflare tunnel LaunchAgent"
if launchctl print "gui/$(id -u)/${AGENT_LABEL}" >/dev/null 2>&1; then
  launchctl print "gui/$(id -u)/${AGENT_LABEL}" | sed -n '1,35p'
else
  echo "LaunchAgent ${AGENT_LABEL} is not loaded."
  echo "Start it with:"
  echo "  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${AGENT_LABEL}.plist"
fi

echo
echo "==> Live API health"
curl -fsS --max-time 20 "${LIVE_URL}"
echo

echo
echo "==> Cloudflare private network routes"
cloudflared tunnel route ip show || true

echo
echo "==> Live admin reachability"
curl -fsSI --max-time 20 "${ADMIN_URL}" | sed -n '1,12p'
