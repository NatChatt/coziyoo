#!/usr/bin/env bash
# scripts/deploy/update.sh — Deploy updates to the Coziyoo Django app.
# Called by GitHub Actions (deploy-django.yml) and update_all.sh shim.
#
# Usage:
#   bash scripts/deploy/update.sh
#   GIT_UPDATE=true bash scripts/deploy/update.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"
load_config
acquire_update_lock

DJANGO_DIR="$(resolve_path "${DJANGO_DIR:-apps/django}")"
VENV_DIR="${DJANGO_DIR}/.venv"
SERVICE_NAME="${DJANGO_SERVICE_NAME:-coziyoo-django}"
ROOT_ENV="${REPO_ROOT}/.env"
PYTHON="${VENV_PYTHON:-python3}"
SETTINGS="${DJANGO_SETTINGS_MODULE:-coziyoo.settings.production}"
DJANGO_PORT="${DJANGO_PORT:-9000}"

[[ -f "${DJANGO_DIR}/manage.py" ]] || fail "manage.py not found in ${DJANGO_DIR}"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
maybe_git_update "${REPO_ROOT}"

# ── 2. Ensure root .env exists ────────────────────────────────────────────────
if [[ ! -f "${ROOT_ENV}" ]]; then
  local_gen="${SCRIPT_DIR}/generate-env.sh"
  [[ -f "${local_gen}" ]] || fail "Root .env missing and generate-env.sh not found"
  log "Root .env missing; regenerating"
  bash "${local_gen}" --output "${ROOT_ENV}"
fi
ensure_ops_runtime_env "${ROOT_ENV}"

# ── 3. Update Python venv ─────────────────────────────────────────────────────
if [[ ! -d "${VENV_DIR}" ]]; then
  log "Creating Python venv at ${VENV_DIR}"
  command -v python3.11 >/dev/null 2>&1 && PYTHON=python3.11 || true
  "${PYTHON}" -m venv "${VENV_DIR}"
fi

log "Installing Python dependencies"
"${VENV_DIR}/bin/pip" install --quiet --upgrade pip
"${VENV_DIR}/bin/pip" install --quiet -r "${DJANGO_DIR}/requirements.txt"

# ── 4. Django management commands ─────────────────────────────────────────────
(
  cd "${DJANGO_DIR}"
  set -a; source "${ROOT_ENV}"; set +a
  export DJANGO_SETTINGS_MODULE="${SETTINGS}"

  log "Running collectstatic"
  "${VENV_DIR}/bin/python" manage.py collectstatic --noinput --clear -v 0

  log "Running migrations"
  "${VENV_DIR}/bin/python" manage.py migrate --noinput

  log "Ensuring superuser"
  email="${DEPLOY_ADMIN_EMAIL:-admin@coziyoo.com}"
  password="${DEPLOY_ADMIN_PASSWORD:-Admin12345}"
  "${VENV_DIR}/bin/python" manage.py shell -c "
from django.contrib.auth.models import User
u, created = User.objects.get_or_create(username='admin', defaults={'email': '${email}', 'is_staff': True, 'is_superuser': True})
if created:
    u.set_password('${password}')
    u.save()
    print('Superuser created')
else:
    print('Superuser already exists')
" 2>&1
)

# ── 5. Restart service ────────────────────────────────────────────────────────
deploy_ops_stack
service_action restart "${SERVICE_NAME}"
log "Service restarted"

# ── 6. Health check ───────────────────────────────────────────────────────────
log "Health checking http://127.0.0.1:${DJANGO_PORT}/v1/health/"
retries="${HEALTHCHECK_RETRIES:-12}"
delay="${HEALTHCHECK_RETRY_DELAY_SECONDS:-5}"
timeout="${HEALTHCHECK_TIMEOUT_SECONDS:-8}"
ok="false"

for ((i=1; i<=retries; i++)); do
  if curl -fsS --max-time "${timeout}" "http://127.0.0.1:${DJANGO_PORT}/v1/health/" >/dev/null; then
    ok="true"; log "Health check passed (${i}/${retries})"; break
  fi
  log "Health check failed (${i}/${retries}), retrying in ${delay}s"
  sleep "${delay}"
done
[[ "${ok}" == "true" ]] || fail "Health checks failed after ${retries} attempts"

# ── 7. Domain validation ──────────────────────────────────────────────────────
validate="${SCRIPT_DIR}/validate-domains.sh"
if [[ -x "${validate}" ]]; then
  bash "${validate}" || log "Domain validation failed; check DNS/TLS/proxy hosts"
fi

log "Update complete"
