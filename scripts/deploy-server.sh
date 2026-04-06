#!/usr/bin/env bash
set -euo pipefail

HOST="${DEPLOY_HOST:-srv1395751.hstgr.cloud}"
USER_NAME="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/coziyoo}"
BRANCH="${DEPLOY_BRANCH:-main}"
SSH_OPTS="${DEPLOY_SSH_OPTS:- -o StrictHostKeyChecking=accept-new }"

echo "Deploy target: ${USER_NAME}@${HOST}"
echo "Branch: ${BRANCH}"
echo "Remote dir: ${REMOTE_DIR}"
echo

ssh ${SSH_OPTS} "${USER_NAME}@${HOST}" "BRANCH='${BRANCH}' REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'EOF'
set -euo pipefail

cd "${REMOTE_DIR}"

echo "==> Remote: $(hostname)"
echo "==> Repo: ${REMOTE_DIR}"
echo "==> Branch: ${BRANCH}"

git fetch origin "${BRANCH}"
git checkout "${BRANCH}"

# Remote host may have local config edits (e.g. .env.local, installation/config.env).
# Use autostash so deploy pulls don't fail on those tracked local changes.
if ! git pull --rebase --autostash origin "${BRANCH}"; then
  echo "WARN: autostash pull failed, trying targeted config-only stash fallback"
  git stash push -m "deploy-config-autostash" -- .env.local installation/config.env || true
  git pull --ff-only origin "${BRANCH}"
  git stash pop || true
fi

bash installation/scripts/update_all.sh
EOF

echo
echo "Deploy completed."
