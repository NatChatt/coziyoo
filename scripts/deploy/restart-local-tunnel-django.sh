#!/usr/bin/env bash
# Restart the local Django process that Cloudflare Tunnel sends admin/api traffic to.
#
# Current tunnel:
#   admin.coziyoo.com -> http://127.0.0.1:9000
#   api.coziyoo.com   -> http://127.0.0.1:9000
#
# Django is managed by the macOS LaunchAgent com.coziyoo.django-dev and runs
# with --noreload, so template/code changes require an explicit restart.
set -euo pipefail

LABEL="${DJANGO_LAUNCH_LABEL:-com.coziyoo.django-dev}"
PORT="${DJANGO_TUNNEL_PORT:-9000}"
HEALTH_URL="${DJANGO_HEALTH_URL:-http://127.0.0.1:${PORT}/v1/health/}"
EXPECT_LIVE_STRING="${EXPECT_LIVE_STRING:-}"
ADMIN_SELLER_URL="${ADMIN_SELLER_URL:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@coziyoo.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin12345}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

uid="$(id -u)"

log "Restarting LaunchAgent ${LABEL}"
launchctl kickstart -k "gui/${uid}/${LABEL}"

log "Waiting for ${HEALTH_URL}"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 5 "${HEALTH_URL}" >/dev/null; then
    log "Local Django health check passed"
    break
  fi
  if [[ "${attempt}" == "10" ]]; then
    fail "Local Django did not become healthy"
  fi
  sleep 1
done

if command -v lsof >/dev/null 2>&1; then
  log "Listener on port ${PORT}"
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN || true
fi

if [[ -n "${EXPECT_LIVE_STRING}" && -n "${ADMIN_SELLER_URL}" ]]; then
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' EXIT

  login_url="https://admin.coziyoo.com/admin/login/?next=/admin/"
  log "Checking live Cloudflare-rendered admin HTML"
  curl -fsS -c "${tmpdir}/cookies.txt" "${login_url}" -o "${tmpdir}/login.html"
  csrf="$(
    python3 - "${tmpdir}/login.html" <<'PY'
import re
import sys

html = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', html)
print(match.group(1) if match else "")
PY
  )"
  [[ -n "${csrf}" ]] || fail "Could not read admin login CSRF token"

  curl -fsS -L \
    -b "${tmpdir}/cookies.txt" \
    -c "${tmpdir}/cookies.txt" \
    -H "Referer: ${login_url}" \
    --data-urlencode "csrfmiddlewaretoken=${csrf}" \
    --data-urlencode "username=${ADMIN_EMAIL}" \
    --data-urlencode "password=${ADMIN_PASSWORD}" \
    --data-urlencode "next=/admin/" \
    "${login_url}" \
    -o "${tmpdir}/after-login.html"

  curl -fsS -b "${tmpdir}/cookies.txt" "${ADMIN_SELLER_URL}" -o "${tmpdir}/seller-detail.html"
  if grep -Fq "${EXPECT_LIVE_STRING}" "${tmpdir}/seller-detail.html"; then
    log "Live HTML contains expected string: ${EXPECT_LIVE_STRING}"
  else
    fail "Live HTML does not contain expected string: ${EXPECT_LIVE_STRING}"
  fi
fi

log "Done"
