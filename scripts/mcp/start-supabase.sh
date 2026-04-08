#!/usr/bin/env bash
# scripts/mcp/start-supabase.sh — Start the Supabase MCP server via supergateway.
# Reads SUPABASE_HOST_URL (or SUPABASE_URL) and SUPABASE_PERSONAL_ACCESS_TOKEN
# (or SUPABASE_ACCESS_TOKEN) from the root .env file.
#
# Usage:
#   bash scripts/mcp/start-supabase.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

read_env_var() {
  local file="$1" key="$2" raw=""
  raw="$(awk -F= -v k="$key" '$1==k {print substr($0, index($0,"=")+1)}' "$file" | tail -n1)"
  raw="${raw%$'\r'}"
  [[ "$raw" =~ ^\".*\"$ ]] && raw="${raw:1:${#raw}-2}"
  [[ "$raw" =~ ^\'.*\'$ ]] && raw="${raw:1:${#raw}-2}"
  printf '%s' "$raw"
}

read_first() {
  local key="$1" val=""
  for f in "${ROOT_DIR}/.env"; do
    [[ -f "$f" ]] || continue
    val="$(read_env_var "$f" "$key")"
    [[ -n "$val" ]] && break
  done
  printf '%s' "$val"
}

SUPABASE_HOST_URL="$(read_first "SUPABASE_HOST_URL")"
[[ -z "${SUPABASE_HOST_URL}" ]] && SUPABASE_HOST_URL="$(read_first "SUPABASE_URL")"

SUPABASE_TOKEN="$(read_first "SUPABASE_PERSONAL_ACCESS_TOKEN")"
[[ -z "${SUPABASE_TOKEN}" ]] && SUPABASE_TOKEN="$(read_first "SUPABASE_ACCESS_TOKEN")"

[[ -n "${SUPABASE_HOST_URL}" ]] || { echo "Missing SUPABASE_HOST_URL (or SUPABASE_URL) in .env" >&2; exit 1; }
[[ -n "${SUPABASE_TOKEN}" ]]    || { echo "Missing SUPABASE_PERSONAL_ACCESS_TOKEN (or SUPABASE_ACCESS_TOKEN) in .env" >&2; exit 1; }

SUPABASE_HOST_URL="${SUPABASE_HOST_URL%/}"
MCP_URL="${SUPABASE_HOST_URL}"
[[ "$MCP_URL" != */mcp ]] && MCP_URL="${MCP_URL}/mcp"

exec npx -y supergateway \
  --streamableHttp "$MCP_URL" \
  --header "authorization:Bearer ${SUPABASE_TOKEN}" \
  "$@"
