#!/usr/bin/env bash
# scripts/deploy/validate-domains.sh — Verify DNS and HTTPS reachability for NPM domains.
#
# Usage:
#   bash scripts/deploy/validate-domains.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"
load_config

API_DOMAIN="${API_DOMAIN:-api.coziyoo.com}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.coziyoo.com}"

log "Validating DNS + HTTPS reachability for ${API_DOMAIN}, ${ADMIN_DOMAIN}"

for host in "${API_DOMAIN}" "${ADMIN_DOMAIN}"; do
  if command -v getent >/dev/null 2>&1; then
    getent hosts "${host}" >/dev/null || fail "DNS resolution failed for ${host}"
  elif command -v dig >/dev/null 2>&1; then
    dig +short "${host}" | grep -q . || fail "DNS resolution failed for ${host}"
  else
    fail "Need getent or dig to validate DNS"
  fi
  curl -fsSIL "https://${host}" >/dev/null || fail "HTTPS check failed for ${host}"
  log "OK: ${host}"
done

curl -fsS "https://${API_DOMAIN}/v1/health/" >/dev/null || fail "API health check failed"

log "Domain validation passed"
