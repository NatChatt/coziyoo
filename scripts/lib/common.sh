#!/usr/bin/env bash
# scripts/lib/common.sh — shared utilities for deploy scripts.
# Source this file; do not execute directly.
set -euo pipefail

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${_LIB_DIR}/../.." && pwd)}"

log() {
  printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"
}

fail() {
  printf "ERROR: %s\n" "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

# Run a command as root (sudo if not already root).
run_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# Load installation/config.env into the environment.
load_config() {
  local cfg="${INSTALL_CONFIG:-${REPO_ROOT}/installation/config.env}"
  local example="${REPO_ROOT}/installation/config.env.example"

  if [[ ! -f "${cfg}" ]]; then
    [[ -f "${example}" ]] || fail "Missing config template at ${example}"
    cp "${example}" "${cfg}"
    echo "Created ${cfg} from ${example}. Edit it for your environment, then rerun."
    exit 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "${cfg}"
  set +a

  REPO_ROOT="${REPO_ROOT:-/opt/coziyoo}"
  if [[ "${REPO_ROOT}" != /* ]]; then
    REPO_ROOT="$(cd "${_LIB_DIR}/../../${REPO_ROOT}" 2>/dev/null && pwd)" \
      || fail "Invalid REPO_ROOT path '${REPO_ROOT}'"
  fi
  [[ -d "${REPO_ROOT}" ]] || run_root mkdir -p "${REPO_ROOT}"
  export REPO_ROOT
}

# Resolve a path relative to REPO_ROOT if not absolute.
resolve_path() {
  local p="$1"
  if [[ "${p}" = /* ]]; then echo "${p}"; else echo "${REPO_ROOT}/${p}"; fi
}

# Pull latest code from git if GIT_UPDATE=true.
maybe_git_update() {
  [[ "${GIT_UPDATE:-false}" == "true" ]] || return 0
  local repo="${1:-${REPO_ROOT}}"
  [[ -d "${repo}/.git" ]] || return 0

  local branch="${DEPLOY_BRANCH:-main}"
  log "Updating repo at ${repo} (branch: ${branch})"
  git config --global --add safe.directory "${repo}" 2>/dev/null || true
  (
    cd "${repo}"
    git fetch --quiet origin
    git checkout -q "${branch}" 2>/dev/null || git checkout -q -B "${branch}" "origin/${branch}"

    local local_head remote_head base_head
    local_head="$(git rev-parse HEAD)"
    remote_head="$(git rev-parse "origin/${branch}")"
    base_head="$(git merge-base HEAD "origin/${branch}")"

    if [[ "${local_head}" == "${remote_head}" ]]; then return; fi
    if [[ "${local_head}" == "${base_head}" ]]; then git pull --quiet --ff-only origin "${branch}"; return; fi
    if [[ "${remote_head}" == "${base_head}" ]]; then git rebase "origin/${branch}"; return; fi

    if [[ "${GIT_RESET_ON_DIVERGENCE:-true}" == "true" ]]; then
      log "Branch diverged from origin; resetting to remote"
      git reset --hard "origin/${branch}"
    else
      fail "Branch ${branch} diverged from origin/${branch}"
    fi
  )
}

# Copy repo to REPO_ROOT if running from a different source directory.
sync_repo_to_root() {
  local source="${SOURCE_REPO_ROOT:-$(cd "${_LIB_DIR}/../.." && pwd)}"
  local target="${REPO_ROOT}"
  [[ "${source}" == "${target}" ]] && return 0
  [[ -d "${source}" ]] || fail "Source repo not found: ${source}"
  run_root mkdir -p "${target}"
  log "Syncing ${source} → ${target}"
  if command -v rsync >/dev/null 2>&1; then
    run_root rsync -a --delete \
      --exclude '.deploy-lock' --exclude 'node_modules' \
      "${source}/" "${target}/"
  else
    run_root find "${target}" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
    run_root bash -lc "shopt -s dotglob; cp -a \"${source}\"/* \"${target}\"/"
  fi
}

service_action() {
  run_root systemctl "${1}" "${2}"
}

ensure_ops_runtime_env() {
  local env_file="${1}"
  [[ -f "${env_file}" ]] || return 0

  local redis_url="redis://:${REDIS_PASSWORD:-CHANGE_ME_REDIS_PASSWORD_12345}@127.0.0.1:${REDIS_PORT:-6379}/1"
  grep -q '^REDIS_URL=' "${env_file}" || printf '\nREDIS_URL=%s\n' "${redis_url}" >> "${env_file}"
  grep -q '^CACHE_KEY_PREFIX=' "${env_file}" || printf 'CACHE_KEY_PREFIX=%s\n' "${CACHE_KEY_PREFIX:-coziyoo}" >> "${env_file}"
  grep -q '^METRICS_ALLOWED_IPS=' "${env_file}" || printf 'METRICS_ALLOWED_IPS=%s\n' "${METRICS_ALLOWED_IPS:-127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}" >> "${env_file}"
}

deploy_ops_stack() {
  [[ "${OPS_ENABLE_MONITORING:-true}" == "true" ]] || { log "OPS_ENABLE_MONITORING=false, skipping ops stack"; return 0; }
  command -v docker >/dev/null 2>&1 || { log "Docker not installed, skipping ops stack"; return 0; }

  local ops_dir; ops_dir="$(resolve_path "${OPS_DIR:-ops/monitoring}")"
  local compose_file="${ops_dir}/docker-compose.yml"
  [[ -f "${compose_file}" ]] || { log "Ops compose file not found at ${compose_file}, skipping"; return 0; }

  log "Starting Redis, Prometheus, and Grafana"
  (
    cd "${ops_dir}"
    export REDIS_PORT="${REDIS_PORT:-6379}"
    export REDIS_PASSWORD="${REDIS_PASSWORD:-CHANGE_ME_REDIS_PASSWORD_12345}"
    export PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
    export GRAFANA_PORT="${GRAFANA_PORT:-3001}"
    export GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
    export GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-CHANGE_ME_GRAFANA_PASSWORD_12345}"

    if docker compose version >/dev/null 2>&1; then
      run_root docker compose -f "${compose_file}" up -d
    else
      run_root docker-compose -f "${compose_file}" up -d
    fi
  )
}

# Prevent concurrent deploys using a lock directory.
acquire_update_lock() {
  local lock_dir="${REPO_ROOT}/.deploy-lock"
  local pid_file="${lock_dir}/pid"
  local retry="${UPDATE_LOCK_RETRY_INTERVAL_SECONDS:-5}"

  while true; do
    if mkdir "${lock_dir}" 2>/dev/null; then
      printf "%s\n" "$$" > "${pid_file}"
      trap "rm -rf '${lock_dir}'" EXIT
      log "Deployment lock acquired"
      return 0
    fi
    if [[ -f "${pid_file}" ]]; then
      local owner; owner="$(tr -dc '0-9' < "${pid_file}" || true)"
      if [[ -n "${owner}" ]] && ! kill -0 "${owner}" 2>/dev/null; then
        log "Removing stale lock (pid=${owner})"
        rm -rf "${lock_dir}" && continue
      fi
    fi
    log "Another deployment is running, waiting ${retry}s..."
    sleep "${retry}"
  done
}
