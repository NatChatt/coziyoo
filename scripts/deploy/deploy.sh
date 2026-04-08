#!/usr/bin/env bash
# scripts/deploy/deploy.sh — Local convenience script: SSH to the VPS and trigger an update.
#
# Usage:
#   bash scripts/deploy/deploy.sh
#   DEPLOY_HOST=my.server.com bash scripts/deploy/deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-srv1395751.hstgr.cloud}"
USER_NAME="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/coziyoo}"
BRANCH="${DEPLOY_BRANCH:-main}"
SSH_OPTS="${DEPLOY_SSH_OPTS:--o StrictHostKeyChecking=accept-new}"

echo "Deploy target: ${USER_NAME}@${HOST}"
echo "Branch:        ${BRANCH}"
echo "Remote dir:    ${REMOTE_DIR}"
echo

# shellcheck disable=SC2029
ssh ${SSH_OPTS} "${USER_NAME}@${HOST}" \
  "BRANCH='${BRANCH}' REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'REMOTE'
set -euo pipefail
cd "${REMOTE_DIR}"

echo "==> Host:   $(hostname)"
echo "==> Repo:   ${REMOTE_DIR}"
echo "==> Branch: ${BRANCH}"

git fetch origin "${BRANCH}"
git checkout "${BRANCH}"

if ! git pull --rebase --autostash origin "${BRANCH}"; then
  echo "WARN: autostash pull failed, trying stash fallback"
  git stash push -m "deploy-autostash" -- .env installation/config.env || true
  git pull --ff-only origin "${BRANCH}"
  git stash pop || true
fi

GIT_UPDATE=false bash scripts/deploy/update.sh
REMOTE

echo
echo "Deploy completed."
