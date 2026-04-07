#!/usr/bin/env bash
# update_django.sh — Deploy / update the Django app on a VPS.
# Called by the GitHub Actions deploy-django workflow via SSH.
# Can also be run manually: bash installation/scripts/update_django.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

DJANGO_DIR="$(resolve_path "${DJANGO_DIR:-apps/django}")"
VENV_DIR="${DJANGO_DIR}/.venv"
SERVICE_NAME="${DJANGO_SERVICE_NAME:-coziyoo-django}"
ROOT_ENV="${REPO_ROOT}/.env"
PYTHON="${VENV_PYTHON:-python3.11}"
DJANGO_SETTINGS="${DJANGO_SETTINGS_MODULE:-coziyoo.settings.production}"

[[ -f "${DJANGO_DIR}/manage.py" ]] || fail "manage.py not found in ${DJANGO_DIR}"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
maybe_git_update "${REPO_ROOT}"

# ── 2. Ensure root .env exists ────────────────────────────────────────────────
if [[ ! -f "${ROOT_ENV}" ]]; then
  GENERATOR="${SCRIPT_DIR}/generate_env.sh"
  if [[ -f "${GENERATOR}" ]]; then
    log "Root .env missing; regenerating"
    bash "${GENERATOR}" --output "${ROOT_ENV}"
  else
    fail "Root .env not found at ${ROOT_ENV}"
  fi
fi

# ── 3. Create/update Python venv ──────────────────────────────────────────────
if [[ ! -d "${VENV_DIR}" ]]; then
  log "Creating Python venv at ${VENV_DIR}"
  "${PYTHON}" -m venv "${VENV_DIR}"
fi

log "Installing Python dependencies"
"${VENV_DIR}/bin/pip" install --quiet --upgrade pip
"${VENV_DIR}/bin/pip" install --quiet -r "${DJANGO_DIR}/requirements.txt"

# ── 4. Load env and run Django management commands ───────────────────────────
(
  cd "${DJANGO_DIR}"

  # Expose .env vars to subprocesses
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_ENV}"
  set +a
  export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS}"

  log "Running collectstatic"
  "${VENV_DIR}/bin/python" manage.py collectstatic --noinput --clear -v 0

  log "Running migrations"
  "${VENV_DIR}/bin/python" manage.py migrate --noinput

  log "Ensuring Django superuser"
  DJANGO_SUPERUSER_EMAIL="${DEPLOY_ADMIN_EMAIL:-admin@coziyoo.com}"
  DJANGO_SUPERUSER_PASSWORD="${DEPLOY_ADMIN_PASSWORD:-Admin12345}"
  "${VENV_DIR}/bin/python" manage.py shell -c "
from django.contrib.auth.models import User
email = '${DJANGO_SUPERUSER_EMAIL}'
password = '${DJANGO_SUPERUSER_PASSWORD}'
u, created = User.objects.get_or_create(username='admin', defaults={'email': email, 'is_staff': True, 'is_superuser': True})
if created:
    u.set_password(password)
    u.save()
    print('Superuser created')
else:
    print('Superuser already exists')
" 2>&1
)

# ── 5. Restart systemd service ────────────────────────────────────────────────
service_action restart "${SERVICE_NAME}"
log "Django service restarted"

# ── 6. Health check ───────────────────────────────────────────────────────────
DJANGO_PORT="${DJANGO_PORT:-9000}"
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-12}"
HEALTHCHECK_RETRY_DELAY_SECONDS="${HEALTHCHECK_RETRY_DELAY_SECONDS:-5}"
HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-8}"

log "Health checking http://127.0.0.1:${DJANGO_PORT}/v1/health/"
health_ok="false"
for ((attempt=1; attempt<=HEALTHCHECK_RETRIES; attempt++)); do
  if curl -fsS --max-time "${HEALTHCHECK_TIMEOUT_SECONDS}" \
       "http://127.0.0.1:${DJANGO_PORT}/v1/health/" >/dev/null; then
    health_ok="true"
    log "Health check passed (attempt ${attempt}/${HEALTHCHECK_RETRIES})"
    break
  fi
  log "Health check failed (attempt ${attempt}/${HEALTHCHECK_RETRIES}), retrying in ${HEALTHCHECK_RETRY_DELAY_SECONDS}s"
  sleep "${HEALTHCHECK_RETRY_DELAY_SECONDS}"
done

[[ "${health_ok}" == "true" ]] || fail "Django health checks failed after ${HEALTHCHECK_RETRIES} attempts"

log "Django update complete"
