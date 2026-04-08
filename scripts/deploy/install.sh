#!/usr/bin/env bash
# scripts/deploy/install.sh — First-time VPS setup.
# Installs system prerequisites, Nginx Proxy Manager (Docker), and the Django app.
#
# Usage:
#   bash scripts/deploy/install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../lib/common.sh"
load_config
sync_repo_to_root

# ─────────────────────────────────────────────────────────────────────────────
# 1. SYSTEM PREREQUISITES
# ─────────────────────────────────────────────────────────────────────────────
install_prereqs() {
  [[ "${INSTALL_PREREQS:-true}" == "true" ]] || { log "INSTALL_PREREQS=false, skipping"; return; }
  log "Installing system prerequisites"

  _apt() {
    if run_root apt-get -y -qq install "$@"; then return 0; fi
    log "apt failed, attempting repair and retry"
    run_root dpkg --configure -a || true
    run_root apt-get -y -qq --fix-broken install || true
    run_root apt-get -qq update || true
    run_root apt-get -y -qq install "$@"
  }

  local missing=()
  for cmd in git curl rsync psql python3; do
    command -v "${cmd}" >/dev/null 2>&1 || missing+=("${cmd}")
  done

  if [[ "${#missing[@]}" -gt 0 ]]; then
    run_root apt-get -qq update
    _apt git curl rsync postgresql-client python3 python3-venv python3-pip \
         python3.11 python3.11-venv python3.11-dev || true
  fi

  log "Prerequisites ready"
}

# ─────────────────────────────────────────────────────────────────────────────
# 2. NGINX PROXY MANAGER (Docker)
# ─────────────────────────────────────────────────────────────────────────────
install_nginx_proxy_manager() {
  log "Setting up Nginx Proxy Manager"

  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker"
    run_root apt-get -qq update
    run_root apt-get install -y docker.io
  fi

  if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
    run_root apt-get install -y docker-compose-plugin \
      || run_root apt-get install -y docker-compose-v2 \
      || run_root apt-get install -y docker-compose
  fi

  run_root systemctl enable docker
  run_root systemctl start docker

  if run_root docker ps --format '{{.Names}}' | grep -qx 'nginx-proxy-manager'; then
    log "Nginx Proxy Manager already running, skipping"
    return
  fi

  if run_root docker ps -a --format '{{.Names}}' | grep -qx 'nginx-proxy-manager'; then
    log "Nginx Proxy Manager container exists but stopped, starting"
    run_root docker start nginx-proxy-manager >/dev/null
    return
  fi

  # Stop local nginx if it's occupying ports
  run_root systemctl is-active --quiet nginx 2>/dev/null && run_root systemctl stop nginx || true

  local npm_dir="${NPM_INSTALL_DIR:-/root/nginx-proxy-manager}"
  run_root mkdir -p "${npm_dir}/data" "${npm_dir}/letsencrypt"

  run_root tee "${npm_dir}/docker-compose.yml" >/dev/null <<EOF
services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: nginx-proxy-manager
    restart: unless-stopped
    ports:
      - "${NPM_HTTP_PORT:-80}:80"
      - "${NPM_HTTPS_PORT:-443}:443"
      - "${NPM_UI_PORT:-81}:81"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
EOF

  if docker compose version >/dev/null 2>&1; then
    run_root docker compose -f "${npm_dir}/docker-compose.yml" up -d
  else
    run_root docker-compose -f "${npm_dir}/docker-compose.yml" up -d
  fi

  log "Nginx Proxy Manager ready"
}

# ─────────────────────────────────────────────────────────────────────────────
# 3. DJANGO APP
# ─────────────────────────────────────────────────────────────────────────────
install_django() {
  log "Installing Django app"

  local django_dir; django_dir="$(resolve_path "${DJANGO_DIR:-apps/django}")"
  local venv_dir="${django_dir}/.venv"
  local service_name="${DJANGO_SERVICE_NAME:-coziyoo-django}"
  local service_file="/etc/systemd/system/${service_name}.service"
  local root_env="${REPO_ROOT}/.env"
  local settings="${DJANGO_SETTINGS_MODULE:-coziyoo.settings.production}"
  local run_user="${DJANGO_RUN_USER:-coziyoo}"
  local run_group="${DJANGO_RUN_GROUP:-coziyoo}"
  local log_dir="${DJANGO_LOG_DIR:-/var/log/coziyoo}"
  local django_port="${DJANGO_PORT:-9000}"

  [[ -f "${django_dir}/manage.py" ]] || fail "manage.py not found in ${django_dir}"

  # Ensure root .env exists
  if [[ ! -f "${root_env}" ]]; then
    local gen="${SCRIPT_DIR}/generate-env.sh"
    [[ -f "${gen}" ]] || fail "Root .env missing and generate-env.sh not found"
    log "Generating root .env"
    bash "${gen}" --output "${root_env}"
  fi

  # Ensure service user/group
  log "Ensuring service user: ${run_user}:${run_group}"
  getent group "${run_group}" >/dev/null 2>&1 || run_root groupadd --system "${run_group}"
  getent passwd "${run_user}" >/dev/null 2>&1 \
    || run_root useradd --system -g "${run_group}" -d "${REPO_ROOT}" -s /sbin/nologin "${run_user}"

  # Select Python
  local python="python3"
  command -v python3.11 >/dev/null 2>&1 && python="python3.11"
  command -v python3.12 >/dev/null 2>&1 && python="python3.12"
  log "Using Python: $("${python}" --version)"

  # Create venv and install deps
  log "Creating virtualenv at ${venv_dir}"
  "${python}" -m venv "${venv_dir}"
  "${venv_dir}/bin/pip" install --quiet --upgrade pip
  "${venv_dir}/bin/pip" install --quiet -r "${django_dir}/requirements.txt"

  # Set ownership
  run_root chown -R "${run_user}:${run_group}" "${REPO_ROOT}"

  # Log directory
  run_root mkdir -p "${log_dir}"
  run_root chown "${run_user}:${run_group}" "${log_dir}"

  # Django management commands
  (
    cd "${django_dir}"
    set -a; source "${root_env}"; set +a
    export DJANGO_SETTINGS_MODULE="${settings}"

    log "Running collectstatic"
    "${venv_dir}/bin/python" manage.py collectstatic --noinput --clear -v 0

    log "Running migrations"
    "${venv_dir}/bin/python" manage.py migrate --noinput

    log "Ensuring superuser"
    local email="${DEPLOY_ADMIN_EMAIL:-admin@coziyoo.com}"
    local password="${DEPLOY_ADMIN_PASSWORD:-Admin12345}"
    "${venv_dir}/bin/python" manage.py shell -c "
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

  # Write systemd service
  log "Writing systemd service: ${service_file}"
  run_root tee "${service_file}" >/dev/null <<EOF
[Unit]
Description=Coziyoo Django (gunicorn)
After=network.target

[Service]
Type=notify
User=${run_user}
Group=${run_group}
WorkingDirectory=${django_dir}
EnvironmentFile=${root_env}
Environment=DJANGO_SETTINGS_MODULE=${settings}

ExecStartPre=/bin/mkdir -p ${log_dir}
ExecStartPre=/bin/chown ${run_user}:${run_group} ${log_dir}

ExecStart=${venv_dir}/bin/gunicorn \\
    --config ${django_dir}/gunicorn.conf.py \\
    coziyoo.wsgi:application

ExecReload=/bin/kill -s HUP \$MAINPID
KillMode=mixed
TimeoutStopSec=30
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  run_root systemctl daemon-reload
  run_root systemctl enable "${service_name}"
  run_root systemctl restart "${service_name}"

  # Health check
  log "Health checking http://127.0.0.1:${django_port}/v1/health/"
  local retries="${HEALTHCHECK_RETRIES:-12}"
  local delay="${HEALTHCHECK_RETRY_DELAY_SECONDS:-5}"
  local timeout="${HEALTHCHECK_TIMEOUT_SECONDS:-8}"
  local ok="false"

  for ((i=1; i<=retries; i++)); do
    if curl -fsS --max-time "${timeout}" "http://127.0.0.1:${django_port}/v1/health/" >/dev/null; then
      ok="true"; log "Health check passed (${i}/${retries})"; break
    fi
    log "Health check failed (${i}/${retries}), retrying in ${delay}s"
    sleep "${delay}"
  done
  [[ "${ok}" == "true" ]] || fail "Health checks failed after ${retries} attempts"

  log "Django installation complete"
}

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
install_prereqs
install_nginx_proxy_manager
install_django

log "All installation steps completed"
