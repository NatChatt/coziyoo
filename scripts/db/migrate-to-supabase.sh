#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERIFY_SCRIPT="$ROOT_DIR/scripts/db/verify-supabase.sh"

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

read_env_var() {
  local key="$1"
  local env_file="$2"
  local raw
  raw="$(awk -F= -v key="$key" '$1==key {print substr($0, index($0, "=") + 1)}' "$env_file" | tail -n 1)"
  raw="${raw%$'\r'}"

  if [[ "$raw" =~ ^\".*\"$ ]]; then
    raw="${raw:1:${#raw}-2}"
  elif [[ "$raw" =~ ^\'.*\'$ ]]; then
    raw="${raw:1:${#raw}-2}"
  fi

  printf "%s" "$raw"
}

resolve_var() {
  local key="$1"
  local env_file="$2"
  local default="${3:-}"

  if [[ -n "${!key:-}" ]]; then
    printf "%s" "${!key}"
    return
  fi

  local from_file
  from_file="$(read_env_var "$key" "$env_file")"
  if [[ -n "$from_file" ]]; then
    printf "%s" "$from_file"
    return
  fi

  printf "%s" "$default"
}

compose_init() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
  else
    fail "Missing docker compose (docker compose or docker-compose)"
  fi
}

dc() {
  "${COMPOSE_CMD[@]}" "$@"
}

add_sslmode_require() {
  local url="$1"
  if [[ "$url" == *"sslmode="* ]]; then
    printf "%s" "$url"
  elif [[ "$url" == *"?"* ]]; then
    printf "%s&sslmode=require" "$url"
  else
    printf "%s?sslmode=require" "$url"
  fi
}

run_source_psql() {
  dc exec -T "$SOURCE_DOCKER_SERVICE" \
    psql -U "$SOURCE_DB_USER" -d "$SOURCE_DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

run_target_psql() {
  dc exec -T "$SOURCE_DOCKER_SERVICE" \
    psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 "$@"
}

service_exists() {
  local service="$1"
  local s
  for s in "${COMPOSE_SERVICES[@]}"; do
    if [[ "$s" == "$service" ]]; then
      return 0
    fi
  done
  return 1
}

stop_maintenance_services() {
  STOPPED_SERVICES=()
  for svc in "${MAINTENANCE_SERVICES[@]}"; do
    if [[ "$svc" == "$SOURCE_DOCKER_SERVICE" ]]; then
      continue
    fi
    if service_exists "$svc"; then
      STOPPED_SERVICES+=("$svc")
    fi
  done

  if (( ${#STOPPED_SERVICES[@]} == 0 )); then
    log "No maintenance services to stop"
    return
  fi

  log "Stopping write-producing services: ${STOPPED_SERVICES[*]}"
  dc stop "${STOPPED_SERVICES[@]}"
}

restart_stopped_services() {
  if (( ${#STOPPED_SERVICES[@]} == 0 )); then
    return
  fi

  log "Restarting stopped services: ${STOPPED_SERVICES[*]}"
  dc up -d "${STOPPED_SERVICES[@]}"
  STOPPED_SERVICES=()
}

cleanup() {
  local exit_code="$1"
  if (( ${#STOPPED_SERVICES[@]} > 0 )); then
    log "Cleanup: attempting to restore stopped services"
    dc up -d "${STOPPED_SERVICES[@]}" || true
  fi

  if (( exit_code != 0 )); then
    log "Migration failed. Review log: $LOG_FILE"
  fi
}

main() {
  require_cmd awk
  require_cmd curl
  require_cmd date
  require_cmd docker
  require_cmd tee

  compose_init

  local env_file="${ENV_FILE:-${ROOT_DIR}/.env}"
  [[ -f "$env_file" ]] || fail "Missing env file: $env_file"

  SOURCE_DOCKER_SERVICE="$(resolve_var SOURCE_DOCKER_SERVICE "$env_file" "postgres")"
  SOURCE_DB_NAME="$(resolve_var SOURCE_DB_NAME "$env_file" "")"
  SOURCE_DB_USER="$(resolve_var SOURCE_DB_USER "$env_file" "")"

  local pgdatabase
  pgdatabase="$(resolve_var PGDATABASE "$env_file" "")"
  local postgres_db
  postgres_db="$(resolve_var POSTGRES_DB "$env_file" "")"
  if [[ -z "$SOURCE_DB_NAME" ]]; then
    SOURCE_DB_NAME="${postgres_db:-${pgdatabase:-coziyoo}}"
  fi

  local pguser
  pguser="$(resolve_var PGUSER "$env_file" "")"
  local postgres_user
  postgres_user="$(resolve_var POSTGRES_USER "$env_file" "")"
  if [[ -z "$SOURCE_DB_USER" ]]; then
    SOURCE_DB_USER="${postgres_user:-${pguser:-coziyoo}}"
  fi

  SUPABASE_DATABASE_URL="$(resolve_var SUPABASE_DATABASE_URL "$env_file" "")"
  SUPABASE_URL="$(resolve_var SUPABASE_URL "$env_file" "")"
  SUPABASE_ACCESS_TOKEN="$(resolve_var SUPABASE_ACCESS_TOKEN "$env_file" "")"

  [[ -n "$SUPABASE_DATABASE_URL" ]] || fail "SUPABASE_DATABASE_URL is required"
  [[ -n "$SUPABASE_URL" ]] || fail "SUPABASE_URL is required"
  [[ -n "$SUPABASE_ACCESS_TOKEN" ]] || fail "SUPABASE_ACCESS_TOKEN is required"

  TARGET_DB_URL="$(add_sslmode_require "$SUPABASE_DATABASE_URL")"

  local ts
  ts="$(date +"%Y%m%d_%H%M%S")"
  ARTIFACT_DIR="${ARTIFACT_DIR:-${ROOT_DIR}/.runtime/supabase-transfer/${ts}}"
  VERIFY_DIR="$ARTIFACT_DIR/verification"
  DUMP_FILE="$ARTIFACT_DIR/public_schema_dump.sql"
  LOG_FILE="$ARTIFACT_DIR/migration.log"
  mkdir -p "$ARTIFACT_DIR" "$VERIFY_DIR"

  exec > >(tee -a "$LOG_FILE") 2>&1

  log "Starting one-time full database transfer to Supabase"
  log "Artifacts directory: $ARTIFACT_DIR"

  COMPOSE_SERVICES=()
  while IFS= read -r service_line; do
    COMPOSE_SERVICES+=("$service_line")
  done < <(dc config --services)
  service_exists "$SOURCE_DOCKER_SERVICE" || fail "Source docker service '$SOURCE_DOCKER_SERVICE' not found in compose services"

  MAINTENANCE_SERVICES=(api admin)
  STOPPED_SERVICES=()
  trap 'cleanup $?' EXIT

  log "Preflight: ensuring source service is running"
  dc up -d "$SOURCE_DOCKER_SERVICE"

  log "Preflight: checking source DB reachability"
  run_source_psql -c "select current_database(), current_user;" >/dev/null

  log "Preflight: checking target Supabase DB reachability (sslmode=require)"
  run_target_psql -c "select current_database(), current_user;" >/dev/null

  log "Preflight: validating Supabase PAT against management API"
  curl -fsS \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Accept: application/json" \
    "https://api.supabase.com/v1/projects" >/dev/null

  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    log "DRY_RUN=1 set: preflight complete, no mutation performed"
    log "Planned dump path: $DUMP_FILE"
    log "Planned log path: $LOG_FILE"
    return 0
  fi

  stop_maintenance_services

  log "Export: dumping source public schema and data"
  dc exec -T "$SOURCE_DOCKER_SERVICE" \
    pg_dump -U "$SOURCE_DB_USER" -d "$SOURCE_DB_NAME" \
    --schema=public \
    --format=plain \
    --no-owner \
    --no-privileges \
    > "$DUMP_FILE"

  [[ -s "$DUMP_FILE" ]] || fail "Dump file is empty: $DUMP_FILE"

  log "Reset target: dropping public schema (dump will recreate schema/extensions)"
  run_target_psql <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
SQL

  log "Import: restoring dump into target Supabase DB"
  dc exec -T "$SOURCE_DOCKER_SERVICE" \
    psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 < "$DUMP_FILE"

  log "Post-import: ANALYZE all public tables"
  run_target_psql <<'SQL'
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ANALYZE VERBOSE %I.%I', rec.schemaname, rec.tablename);
  END LOOP;
END $$;
SQL

  log "Post-import: sequence alignment"
  run_target_psql <<'SQL'
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      a.attname AS column_name,
      pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS sequence_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    IF rec.sequence_name IS NOT NULL THEN
      EXECUTE format(
        'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I.%I), 1), true);',
        rec.sequence_name,
        rec.column_name,
        rec.schema_name,
        rec.table_name
      );
    END IF;
  END LOOP;
END $$;
SQL

  log "Verification: comparing source and target snapshots"
  OUTPUT_DIR="$VERIFY_DIR" \
  SOURCE_DOCKER_SERVICE="$SOURCE_DOCKER_SERVICE" \
  SOURCE_DB_NAME="$SOURCE_DB_NAME" \
  SOURCE_DB_USER="$SOURCE_DB_USER" \
  SUPABASE_DATABASE_URL="$SUPABASE_DATABASE_URL" \
  bash "$VERIFY_SCRIPT"

  restart_stopped_services

  log "Transfer complete"
  log "Dump file: $DUMP_FILE"
  log "Log file: $LOG_FILE"
  log "Verification dir: $VERIFY_DIR"
}

main "$@"
