#!/usr/bin/env bash
# Deploy Django on the home Ubuntu server.
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT:-/home/server/coziyoo}"
BRANCH="${DEPLOY_BRANCH:-main}"
DJANGO_DIR="${REPO_ROOT}/apps/django"
PYTHON="${DJANGO_DIR}/.venv/bin/python"
SERVICE_NAME="${DJANGO_SYSTEMD_SERVICE:-coziyoo-django.service}"
HEALTH_URL="${DJANGO_HEALTH_URL:-http://127.0.0.1:9000/v1/health/}"

log() {
  printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"
}

fail() {
  printf "ERROR: %s\n" "$*" >&2
  exit 1
}

[[ -d "${REPO_ROOT}/.git" ]] || fail "Repo not found: ${REPO_ROOT}"
[[ -x "${PYTHON}" ]] || fail "Python venv not found: ${PYTHON}"
[[ -f "${DJANGO_DIR}/.env" ]] || fail "Django .env not found: ${DJANGO_DIR}/.env"

cd "${REPO_ROOT}"

log "Updating ${REPO_ROOT} from origin/${BRANCH}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --rebase --autostash origin "${BRANCH}"

log "Running Django checks and migrations"
(
  set -a
  # shellcheck disable=SC1091
  source "${DJANGO_DIR}/.env"
  set +a
  cd "${DJANGO_DIR}"
  export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-coziyoo.settings.production}"
  "${PYTHON}" -m pip install -r requirements.txt
  "${PYTHON}" manage.py check
  "${PYTHON}" manage.py migrate --noinput
  "${PYTHON}" manage.py collectstatic --noinput
)

log "Reloading ${SERVICE_NAME}"
MAIN_PID="$(systemctl show -p MainPID --value "${SERVICE_NAME}" 2>/dev/null || true)"
if [[ -n "${MAIN_PID}" && "${MAIN_PID}" != "0" ]]; then
  kill -HUP "${MAIN_PID}"
else
  fail "Could not find MainPID for ${SERVICE_NAME}"
fi

log "Health checking ${HEALTH_URL}"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 8 "${HEALTH_URL}" >/dev/null; then
    log "Health check passed"
    exit 0
  fi
  log "Health check failed (${attempt}/10), retrying"
  sleep 3
done

fail "Health check failed after restart"
