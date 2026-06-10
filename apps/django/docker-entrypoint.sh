#!/usr/bin/env sh
# Coziyoo Django container entrypoint.
# Migrations are opt-in (RUN_MIGRATIONS=true) so they don't run on every replica
# start by default. On a single-instance Coolify deploy you can set it to true,
# or run `python manage.py migrate` from Coolify's pre-deployment command instead.
set -e

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] Running database migrations..."
  python manage.py migrate --noinput
fi

exec "$@"
