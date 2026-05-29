#!/usr/bin/env bash
# Ensure the Coziyoo GitHub Actions home runner is healthy.
#
# Usage:
#   bash scripts/deploy/ensure-home-runner.sh
#
# Optional env:
#   RUNNER_HOST=100.64.32.43
#   RUNNER_HOSTS="100.64.32.43 192.168.1.100"
#   RUNNER_USER=server
#   RUNNER_KEY=/path/to/key

set -Eeuo pipefail

RUNNER_HOST="${RUNNER_HOST:-}"
RUNNER_HOSTS="${RUNNER_HOSTS:-100.64.32.43 192.168.1.100}"
RUNNER_USER="${RUNNER_USER:-server}"
RUNNER_KEY="${RUNNER_KEY:-${HOME}/.ssh/id_ed25519_server_192_168_1_100}"
RUNNER_DIR="${RUNNER_DIR:-/home/server/actions-runner/coziyoo-v2}"
SERVICE_NAME="${SERVICE_NAME:-actions.runner.ismetkarakus-coziyoo-v2.coziyoo-home-linux.service}"
RUN_ID="${RUN_ID:-26660603730}"

SSH_OPTS=(
  -i "${RUNNER_KEY}"
  -o BatchMode=yes
  -o ConnectTimeout=8
)

log() {
  printf '==> %s\n' "$*"
}

select_runner_host() {
  local candidates
  if [[ -n "${RUNNER_HOST}" ]]; then
    candidates="${RUNNER_HOST}"
  else
    candidates="${RUNNER_HOSTS}"
  fi

  local host
  for host in ${candidates}; do
    log "Checking SSH access to ${RUNNER_USER}@${host}"
    if ssh "${SSH_OPTS[@]}" "${RUNNER_USER}@${host}" "hostname; whoami"; then
      RUNNER_HOST="${host}"
      return 0
    fi
  done

  printf 'No runner host reachable. Tried: %s\n' "${candidates}" >&2
  return 1
}

select_runner_host

log "Repairing runner process state"
ssh "${SSH_OPTS[@]}" "${RUNNER_USER}@${RUNNER_HOST}" "RUNNER_DIR='${RUNNER_DIR}' SERVICE_NAME='${SERVICE_NAME}' bash -s" <<'REMOTE'
set -Eeuo pipefail

service_listener_pids="$(
  ps -u "$(whoami)" -o pid=,cmd= |
    awk '/Runner.Listener run --startuptype service/ { print $1 }'
)"

manual_pids="$(
  ps -u "$(whoami)" -o pid=,cmd= |
    awk -v runner_dir="${RUNNER_DIR}" '
      index($0, runner_dir "/run.sh") ||
      index($0, runner_dir "/run-helper.sh") ||
      ($0 ~ /Runner.Listener run$/) {
        print $1
      }
    '
)"

if [[ -n "${manual_pids}" ]]; then
  echo "Stopping manual runner processes: ${manual_pids}"
  # shellcheck disable=SC2086
  kill ${manual_pids} 2>/dev/null || true
  sleep 2
fi

if systemctl is-active --quiet "${SERVICE_NAME}"; then
  echo "Runner service is active."
else
  echo "Runner service is not active."
  if sudo -n true 2>/dev/null; then
    sudo systemctl restart "${SERVICE_NAME}"
  else
    echo "Cannot restart service without sudo. Run on runner machine:"
    echo "  sudo systemctl restart ${SERVICE_NAME}"
  fi
fi

systemctl status "${SERVICE_NAME}" --no-pager -n 12 || true

echo
echo "Remaining runner listeners:"
ps -u "$(whoami)" -o pid,ppid,cmd |
  grep -E "${RUNNER_DIR}/(run.sh|run-helper.sh)|Runner.Listener" |
  grep -v grep || true
REMOTE

if command -v curl >/dev/null 2>&1; then
  log "Latest deploy run status"
  curl -sS "https://api.github.com/repos/ismetkarakus/coziyoo-v2/actions/runs/${RUN_ID}" |
    sed -nE 's/.*"(status|conclusion|updated_at)"[[:space:]]*:[[:space:]]*"?([^",]+)"?.*/\1: \2/p' || true
fi

log "Done"
