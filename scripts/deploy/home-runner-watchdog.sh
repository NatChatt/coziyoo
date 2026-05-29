#!/usr/bin/env bash
# Watchdog for the Coziyoo GitHub Actions home runner.
# Intended to run on the home runner machine as the `server` user.

set -Eeuo pipefail

RUNNER_DIR="${RUNNER_DIR:-/home/server/actions-runner/coziyoo-v2}"
SERVICE_NAME="${SERVICE_NAME:-actions.runner.ismetkarakus-coziyoo-v2.coziyoo-home-linux.service}"
LOG_FILE="${LOG_FILE:-/home/server/coziyoo-logs/runner-watchdog.log}"

mkdir -p "$(dirname "${LOG_FILE}")"

log() {
  printf '%s %s\n' "$(date -Is)" "$*" >> "${LOG_FILE}"
}

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
  log "Stopping manual runner processes: ${manual_pids}"
  # shellcheck disable=SC2086
  kill ${manual_pids} 2>/dev/null || true
fi

if systemctl is-active --quiet "${SERVICE_NAME}"; then
  log "Runner service active"
  exit 0
fi

log "Runner service inactive"
if sudo -n true 2>/dev/null; then
  log "Restarting runner service"
  sudo systemctl restart "${SERVICE_NAME}" >> "${LOG_FILE}" 2>&1 || log "Restart failed"
else
  log "No passwordless sudo; systemd should restart the enabled service automatically after boot"
fi
