#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

log() {
  printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"
}

fail() {
  printf "ERROR: %s\n" "$*" >&2
  exit 1
}

os_type() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    Darwin) echo "macos" ;;
    *) fail "Unsupported OS: $(uname -s)" ;;
  esac
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

# Simple sudo wrapper for root deployment
run_root() {
  local as_user=""
  if [[ "${1:-}" == "-u" ]]; then
    as_user="${2:-}"
    shift 2
  fi

  if [[ -n "${as_user}" ]]; then
    if [[ "${EUID}" -eq 0 ]]; then
      if command -v runuser >/dev/null 2>&1; then
        runuser -u "${as_user}" -- "$@"
      else
        su -s /bin/bash -c "$(printf '%q ' "$@")" "${as_user}"
      fi
    else
      sudo -u "${as_user}" "$@"
    fi
  else
    if [[ "${EUID}" -eq 0 ]]; then
      "$@"
    else
      sudo "$@"
    fi
  fi
}

load_config() {
  local cfg="${INSTALL_CONFIG:-${INSTALL_DIR}/config.env}"
  [[ -f "${cfg}" ]] || fail "Missing config at ${cfg}. Copy installation/config.env.example to installation/config.env first."

  # Use native bash source for .env files
  set -a
  # shellcheck disable=SC1090
  source "${cfg}"
  set +a

  local detected_repo_root
  detected_repo_root="$(cd "${INSTALL_DIR}/.." && pwd)"
  SOURCE_REPO_ROOT="${detected_repo_root}"
  REPO_ROOT="${REPO_ROOT:-/opt/coziyoo}"
  if [[ "${REPO_ROOT}" != /* ]]; then
    REPO_ROOT="$(cd "${INSTALL_DIR}/${REPO_ROOT}" 2>/dev/null && pwd)" || fail "Invalid REPO_ROOT path '${REPO_ROOT}' in ${cfg}"
  fi
  if [[ ! -d "${REPO_ROOT}" ]]; then
    run_root mkdir -p "${REPO_ROOT}"
  fi

  API_RUN_USER="${API_RUN_USER:-coziyoo}"
  API_RUN_GROUP="${API_RUN_GROUP:-coziyoo}"
  export SOURCE_REPO_ROOT REPO_ROOT API_RUN_USER API_RUN_GROUP
}

export_env_file_kv() {
  local env_file="$1"
  [[ -f "${env_file}" ]] || fail "Env file not found: ${env_file}"

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
}

resolve_path() {
  local p="$1"
  if [[ "${p}" = /* ]]; then
    echo "${p}"
  else
    echo "${REPO_ROOT}/${p}"
  fi
}

maybe_git_update() {
  local repo="$1"
  if [[ "${GIT_UPDATE:-false}" != "true" ]]; then
    return
  fi
  if [[ ! -d "${repo}/.git" ]]; then
    log "Skipping git update in ${repo} (no .git directory)"
    return
  fi

  local branch="${DEPLOY_BRANCH:-main}"
  local reset_on_divergence="${GIT_RESET_ON_DIVERGENCE:-true}"
  log "Updating repo at ${repo} on branch ${branch}"

  # Add safe directory unconditionally
  git config --global --add safe.directory "${repo}" 2>/dev/null || true

  (
    cd "${repo}"
    git fetch --quiet origin
    if git show-ref --verify --quiet "refs/heads/${branch}"; then
      git checkout -q "${branch}"
    else
      git checkout -q -B "${branch}" "origin/${branch}"
    fi

    local_head="$(git rev-parse HEAD)"
    remote_head="$(git rev-parse "origin/${branch}")"
    base_head="$(git merge-base HEAD "origin/${branch}")"

    if [[ "${local_head}" == "${remote_head}" ]]; then
      return
    fi

    if [[ "${local_head}" == "${base_head}" ]]; then
      git pull --quiet --ff-only origin "${branch}"
      return
    fi

    if [[ "${remote_head}" == "${base_head}" ]]; then
      log "Local branch ${branch} is ahead of origin/${branch}; rebasing local commits on top of origin"
      git rebase "origin/${branch}"
      return
    fi

    if [[ "${reset_on_divergence}" == "true" ]]; then
      log "Local branch ${branch} diverged from origin/${branch}; resetting to remote head"
      git reset --hard "origin/${branch}"
      return
    fi

    fail "Branch ${branch} diverged from origin/${branch}. Set GIT_RESET_ON_DIVERGENCE=true to auto-reset during deploy."
  )
}

sync_repo_to_root() {
  local source="${SOURCE_REPO_ROOT:-$(cd "${INSTALL_DIR}/.." && pwd)}"
  local target="${REPO_ROOT}"

  [[ -d "${source}" ]] || fail "Source repo directory not found: ${source}"
  if [[ "${source}" == "${target}" ]]; then
    return
  fi

  run_root mkdir -p "${target}"
  log "Syncing repository from ${source} to ${target}"
  if command -v rsync >/dev/null 2>&1; then
    run_root rsync -a --delete \
      --exclude '.deploy-lock' \
      --exclude 'node_modules' \
      "${source}/" "${target}/"
  else
    log "rsync not found, using fallback copy mode"
    run_root find "${target}" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
    run_root bash -lc "shopt -s dotglob; cp -a \"${source}\"/* \"${target}\"/"
    run_root rm -rf "${target}/node_modules" "${target}/.deploy-lock"
  fi
}

install_python_project() {
  local app_dir="$1"
  local venv_dir="${app_dir}/.venv"

  require_cmd python3
  log "Installing Python dependencies in ${app_dir}"
  if [[ -d "${venv_dir}" ]]; then
    log "Removing existing virtualenv at ${venv_dir} to avoid stale/corrupt package metadata"
    rm -rf "${venv_dir}"
  fi
  python3 -m venv "${venv_dir}"

  # shellcheck disable=SC1091
  source "${venv_dir}/bin/activate"
  python -m pip install --quiet --upgrade pip

  if [[ -f "${app_dir}/requirements.txt" ]]; then
    pip install --quiet -r "${app_dir}/requirements.txt"
  elif [[ -f "${app_dir}/pyproject.toml" ]]; then
    pip install --quiet "${app_dir}"
  else
    fail "No requirements.txt or pyproject.toml found in ${app_dir}"
  fi
}

service_action() {
  local action="$1"
  local service="$2"
  run_root systemctl "${action}" "${service}"
}

acquire_update_lock() {
  local lock_dir="${REPO_ROOT}/.deploy-lock"
  local lock_pid_file="${lock_dir}/pid"
  local lock_meta_file="${lock_dir}/meta"
  local wait_seconds="${UPDATE_LOCK_WAIT_SECONDS:-0}" # 0 = wait forever
  local retry_interval="${UPDATE_LOCK_RETRY_INTERVAL_SECONDS:-5}"
  local waited=0

  while true; do
    if mkdir "${lock_dir}" 2>/dev/null; then
      printf "%s\n" "$$" > "${lock_pid_file}"
      printf "host=%s\nstarted_at=%s\n" "$(hostname)" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "${lock_meta_file}"
      trap "rm -rf '${lock_dir}'" EXIT
      log "Deployment lock acquired (${lock_dir})"
      return 0
    fi

    # If lock owner PID is gone, clear stale lock and retry immediately.
    if [[ -f "${lock_pid_file}" ]]; then
      local owner_pid
      owner_pid="$(tr -dc '0-9' < "${lock_pid_file}" || true)"
      if [[ -n "${owner_pid}" ]] && ! kill -0 "${owner_pid}" 2>/dev/null; then
        log "Stale deployment lock detected (pid=${owner_pid}), removing ${lock_dir}"
        rm -rf "${lock_dir}" || true
        continue
      fi
    fi

    if [[ "${wait_seconds}" -gt 0 && "${waited}" -ge "${wait_seconds}" ]]; then
      fail "Timed out waiting for deployment lock after ${waited}s (lock: ${lock_dir})"
    fi

    log "Another deployment is running, waiting for lock: ${lock_dir} (waited ${waited}s)"
    sleep "${retry_interval}"
    waited=$((waited + retry_interval))
  done
}

# Shared npm install from workspace root.
# Tries npm ci first (fast, reproducible); falls back to npm install if ci fails.
# Call from within REPO_ROOT or any subdir — this always cd's to REPO_ROOT.
npm_install_from_root() {
  local flags=(--silent --no-audit --no-fund --loglevel=error)
  (
    cd "${REPO_ROOT}"
    if [[ -f package-lock.json ]]; then
      if ! npm ci "${flags[@]}"; then
        log "npm ci failed (likely lock/platform mismatch), retrying with npm install"
        rm -rf node_modules
        npm install "${flags[@]}"
      fi
    else
      npm install "${flags[@]}"
    fi
  )
}

# Shared function for ensuring API env defaults.
# Only non-secret infrastructure defaults are set here. Secrets (JWT, webhook,
# API keys) MUST be generated via generate_env.sh — never hardcoded.
ensure_api_env_defaults() {
  local env_file="$1"
  local pg_db_default="${PG_DB:-coziyoo}"
  local pg_user_default="${PG_USER:-coziyoo}"
  local pg_password_default="${PG_PASSWORD:-coziyoo}"
  local admin_domain="${ADMIN_DOMAIN:-admin.coziyoo.com}"
  local cors_default="${API_CORS_ALLOWED_ORIGINS:-https://${admin_domain},http://${admin_domain},http://localhost:8081,http://localhost:5173,http://localhost:19006}"
  local defaults=(
    "PGHOST=127.0.0.1"
    "PGPORT=5432"
    "PGUSER=${pg_user_default}"
    "PGPASSWORD=${pg_password_default}"
    "PGDATABASE=${pg_db_default}"
    "CORS_ALLOWED_ORIGINS=${cors_default}"
  )

  if [[ ! -f "${env_file}" ]]; then
    log "Creating API env file at ${env_file}"
    mkdir -p "$(dirname "${env_file}")"
    printf "%s\n" "${defaults[@]}" > "${env_file}"
    # Secrets are missing — generate them
    local generator="${SCRIPT_DIR}/generate_env.sh"
    if [[ -f "${generator}" ]]; then
      log "Generating secrets via generate_env.sh"
      bash "${generator}" --force --output "${env_file}"
    else
      fail "Env file created without secrets and generate_env.sh is missing. Generate secrets manually."
    fi
    return
  fi

  local entry key
  for entry in "${defaults[@]}"; do
    key="${entry%%=*}"
    if ! grep -q "^${key}=" "${env_file}"; then
      echo "${entry}" >> "${env_file}"
    fi
  done
}
