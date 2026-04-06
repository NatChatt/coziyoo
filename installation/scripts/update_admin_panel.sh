#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

ADMIN_DIR_ABS="$(resolve_path "${ADMIN_DIR:-apps/admin}")"
PUBLISH_DIR="${ADMIN_PUBLISH_DIR:-/var/www/coziyoo-admin}"
ADMIN_API_BASE_URL="${ADMIN_API_BASE_URL:-https://${API_DOMAIN:-api.coziyoo.com}}"
ADMIN_SERVICE_NAME="${ADMIN_SERVICE_NAME:-coziyoo-admin}"
ROOT_NODE_MODULES="${REPO_ROOT}/node_modules"
ADMIN_NODE_MODULES="${ADMIN_DIR_ABS}/node_modules"

[[ -f "${ADMIN_DIR_ABS}/package.json" ]] || fail "Admin package.json not found in ${ADMIN_DIR_ABS}"

maybe_git_update "${REPO_ROOT}"

(
  cd "${ADMIN_DIR_ABS}"
  BUILD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  cat > .env.production <<EOF
VITE_API_BASE_URL=${ADMIN_API_BASE_URL}
VITE_GIT_COMMIT=${BUILD_COMMIT}
EOF
  # Remove any stale app-local node_modules left from a pre-workspace standalone
  # install. Packages are now hoisted to the workspace root; a local node_modules
  # causes TypeScript to pick up wrong/old versions before the root ones.
  if [[ -d "${ADMIN_NODE_MODULES}" ]]; then
    log "Removing stale admin-local node_modules (workspace root handles deps)"
    rm -rf "${ADMIN_NODE_MODULES}"
  fi

  needs_install="false"
  if [[ ! -d "${ROOT_NODE_MODULES}" ]]; then
    needs_install="true"
  fi

  # Ensure core admin build deps are resolvable from workspace root.
  if ! node -e "require.resolve('vite'); require.resolve('@vitejs/plugin-react'); require.resolve('vite/client')" >/dev/null 2>&1; then
    needs_install="true"
  fi

  if [[ "${needs_install}" == "true" ]]; then
    log "Admin dependencies missing/incomplete; installing dependencies from workspace root"
    npm_install_from_root
    cd "${ADMIN_DIR_ABS}"
  fi
  build_log="$(mktemp)"
  if npm run build 2>&1 | tee "${build_log}"; then
    rm -f "${build_log}"
  else
    if grep -Eq "Cannot find module '?@rollup/rollup-|npm has a bug related to optional dependencies" "${build_log}"; then
      log "Admin build hit Rollup optional-dependency issue; reinstalling root deps and retrying build"
      rm -rf "${ROOT_NODE_MODULES}"
      (
        cd "${REPO_ROOT}"
        npm install --silent --no-audit --no-fund --loglevel=error --include=optional
      )
      cd "${ADMIN_DIR_ABS}"
      npm run build
      rm -f "${build_log}"
    else
      rm -f "${build_log}"
      exit 1
    fi
  fi
)

run_root mkdir -p "${PUBLISH_DIR}"
run_root rsync -a --delete "${ADMIN_DIR_ABS}/dist/" "${PUBLISH_DIR}/"

# Restart the admin panel service
service_action restart "${ADMIN_SERVICE_NAME}"

log "Admin updated"
