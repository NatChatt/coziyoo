#!/usr/bin/env bash
# scripts/deploy/generate-env.sh — Generate root .env from .env.example + installation/config.env.
#
# Usage:
#   bash scripts/deploy/generate-env.sh [--force] [--output /path/to/.env]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEMPLATE_PATH="${REPO_ROOT}/.env.example"
INSTALL_CFG_PATH="${REPO_ROOT}/installation/config.env"
OUTPUT_PATH="${REPO_ROOT}/.env"
FORCE="false"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/deploy/generate-env.sh [--force] [--output /path/to/.env]

Options:
  --force            Overwrite output file if it already exists.
  --output PATH      Output .env file path (default: <repo>/.env).
  -h, --help         Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)  FORCE="true"; shift ;;
    --output) OUTPUT_PATH="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -f "${TEMPLATE_PATH}" ]]    || { echo "ERROR: Missing template: ${TEMPLATE_PATH}" >&2; exit 1; }
[[ -f "${INSTALL_CFG_PATH}" ]] || { echo "ERROR: Missing install config: ${INSTALL_CFG_PATH}" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required" >&2; exit 1; }

if [[ -f "${OUTPUT_PATH}" && "${FORCE}" != "true" ]]; then
  echo "ERROR: ${OUTPUT_PATH} already exists. Use --force to overwrite." >&2
  exit 1
fi

# Load installation config
set -a
# shellcheck disable=SC1090
source "${INSTALL_CFG_PATH}"
set +a

# Validate required config keys
required_keys=(API_DOMAIN ADMIN_DOMAIN DJANGO_PORT DEPLOY_BRANCH REPO_ROOT PG_DB PG_USER PG_PASSWORD DEPLOY_ADMIN_EMAIL DEPLOY_ADMIN_PASSWORD)
for key in "${required_keys[@]}"; do
  [[ -n "${!key:-}" ]] || { echo "ERROR: Required key '${key}' missing in ${INSTALL_CFG_PATH}" >&2; exit 1; }
done

# Derived values
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@${PGHOST}:${PGPORT}/${PG_DB}"
CORS_VALUE="https://${ADMIN_DOMAIN},https://coziyoo.com,http://${ADMIN_DOMAIN},http://localhost:8081,http://localhost:5173,http://localhost:19006"

# Generate secrets
declare -A secrets
for sk in APP_JWT_SECRET ADMIN_JWT_SECRET PAYMENT_WEBHOOK_SECRET AI_SERVER_SHARED_SECRET; do
  if [[ "${sk}" == "PAYMENT_WEBHOOK_SECRET" || "${sk}" == "AI_SERVER_SHARED_SECRET" ]]; then
    secrets[$sk]="$(openssl rand -hex 24)"
  else
    secrets[$sk]="$(openssl rand -hex 32)"
  fi
done

# Build output file from template
mkdir -p "$(dirname "${OUTPUT_PATH}")"
tmp_file="$(mktemp "${OUTPUT_PATH}.tmp.XXXXXX")"
trap 'rm -f "${tmp_file}"' EXIT

while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ ! "$line" =~ ^[A-Z0-9_]+= ]]; then
    echo "$line" >> "$tmp_file"; continue
  fi

  key="${line%%=*}"
  val="${line#*=}"

  # Replace with generated secrets if placeholder
  if [[ -n "${secrets[$key]:-}" ]] && [[ -z "$val" || "$val" =~ change_me|yourdomain|example\.com ]]; then
    echo "${key}=${secrets[$key]}" >> "$tmp_file"; continue
  fi

  case "$key" in
    ADMIN_DOMAIN)              echo "ADMIN_DOMAIN=${ADMIN_DOMAIN}" >> "$tmp_file" ;;
    API_DOMAIN)                echo "API_DOMAIN=${API_DOMAIN}" >> "$tmp_file" ;;
    DEPLOY_BRANCH)             echo "DEPLOY_BRANCH=${DEPLOY_BRANCH}" >> "$tmp_file" ;;
    REPO_ROOT)                 echo "REPO_ROOT=${REPO_ROOT}" >> "$tmp_file" ;;
    DEPLOY_ADMIN_EMAIL)        echo "DEPLOY_ADMIN_EMAIL=${DEPLOY_ADMIN_EMAIL}" >> "$tmp_file" ;;
    DEPLOY_ADMIN_PASSWORD)     echo "DEPLOY_ADMIN_PASSWORD=${DEPLOY_ADMIN_PASSWORD}" >> "$tmp_file" ;;
    PGHOST)                    echo "PGHOST=${PGHOST}" >> "$tmp_file" ;;
    PGPORT)                    echo "PGPORT=${PGPORT}" >> "$tmp_file" ;;
    PGUSER)                    echo "PGUSER=${PG_USER}" >> "$tmp_file" ;;
    PGPASSWORD)                echo "PGPASSWORD=${PG_PASSWORD}" >> "$tmp_file" ;;
    PGDATABASE)                echo "PGDATABASE=${PG_DB}" >> "$tmp_file" ;;
    DATABASE_URL)              echo "DATABASE_URL=${DATABASE_URL}" >> "$tmp_file" ;;
    CORS_ALLOWED_ORIGINS)      echo "CORS_ALLOWED_ORIGINS=${CORS_VALUE}" >> "$tmp_file" ;;
    DJANGO_SETTINGS_MODULE)    echo "DJANGO_SETTINGS_MODULE=${DJANGO_SETTINGS_MODULE:-coziyoo.settings.production}" >> "$tmp_file" ;;
    *)                         echo "$line" >> "$tmp_file" ;;
  esac
done < "${TEMPLATE_PATH}"

# Append any mandatory keys missing from the template
_append_if_missing() {
  grep -q "^${1}=" "$tmp_file" || echo "${1}=${2}" >> "$tmp_file"
}
_append_if_missing "PGHOST"            "${PGHOST}"
_append_if_missing "PGPORT"            "${PGPORT}"
_append_if_missing "PGUSER"            "${PG_USER}"
_append_if_missing "PGPASSWORD"        "${PG_PASSWORD}"
_append_if_missing "PGDATABASE"        "${PG_DB}"
_append_if_missing "DATABASE_URL"      "${DATABASE_URL}"
_append_if_missing "CORS_ALLOWED_ORIGINS" "${CORS_VALUE}"

# Final validation
for check in DATABASE_URL APP_JWT_SECRET ADMIN_JWT_SECRET PAYMENT_WEBHOOK_SECRET CORS_ALLOWED_ORIGINS; do
  grep -q "^${check}=" "$tmp_file" || { echo "ERROR: generated env missing ${check}" >&2; exit 1; }
done

mv "$tmp_file" "${OUTPUT_PATH}"
trap - EXIT

echo "Generated: ${OUTPUT_PATH}"
echo "Generated secrets successfully."
