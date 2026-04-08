#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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

QUERY_TABLE_LIST=$(cat <<'SQL'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
SQL
)

QUERY_ROW_COUNTS=$(cat <<'SQL'
WITH tables AS (
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
)
SELECT
  table_name,
  COALESCE(
    (
      xpath(
        '/row/c/text()',
        query_to_xml(
          format('select count(*) as c from %I.%I', table_schema, table_name),
          false,
          true,
          ''
        )
      )
    )[1]::text::bigint,
    0
  ) AS row_count
FROM tables
ORDER BY table_name;
SQL
)

QUERY_INVALID_CONSTRAINTS=$(cat <<'SQL'
SELECT
  conrelid::regclass::text AS table_name,
  conname,
  contype
FROM pg_constraint c
JOIN pg_class cl ON cl.oid = c.conrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
WHERE n.nspname = 'public'
  AND NOT c.convalidated
ORDER BY table_name, conname;
SQL
)

QUERY_SPOT_CHECKS=$(cat <<'SQL'
WITH checks(table_name) AS (
  VALUES
    ('users'),
    ('orders'),
    ('foods'),
    ('messages'),
    ('seller_ledger_entries'),
    ('seller_payout_batches'),
    ('seller_payout_items')
), normalized AS (
  SELECT
    c.table_name,
    CASE
      WHEN to_regclass(format('public.%I', c.table_name)) IS NULL THEN -1::bigint
      ELSE COALESCE(
        (
          xpath(
            '/row/c/text()',
            query_to_xml(format('select count(*) as c from public.%I', c.table_name), false, true, '')
          )
        )[1]::text::bigint,
        0
      )
    END AS row_count
  FROM checks c
)
SELECT table_name, row_count
FROM normalized
ORDER BY table_name;
SQL
)

run_source_csv() {
  local out_file="$1"
  local query="$2"
  dc exec -T "$SOURCE_DOCKER_SERVICE" \
    psql -U "$SOURCE_DB_USER" -d "$SOURCE_DB_NAME" -v ON_ERROR_STOP=1 --csv -c "$query" > "$out_file"
}

run_target_csv() {
  local out_file="$1"
  local query="$2"
  dc exec -T "$SOURCE_DOCKER_SERVICE" \
    psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 --csv -c "$query" > "$out_file"
}

compare_csv() {
  local left="$1"
  local right="$2"
  local diff_out="$3"

  if diff -u "$left" "$right" > "$diff_out"; then
    return 0
  fi

  return 1
}

main() {
  require_cmd awk
  require_cmd diff
  require_cmd docker

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

  local supabase_database_url
  supabase_database_url="$(resolve_var SUPABASE_DATABASE_URL "$env_file" "")"
  [[ -n "$supabase_database_url" ]] || fail "SUPABASE_DATABASE_URL is required"
  TARGET_DB_URL="$(add_sslmode_require "$supabase_database_url")"

  OUTPUT_DIR="${OUTPUT_DIR:-${ROOT_DIR}/.runtime/supabase-transfer/verification}"
  mkdir -p "$OUTPUT_DIR"

  local source_tables="$OUTPUT_DIR/source_tables.csv"
  local target_tables="$OUTPUT_DIR/target_tables.csv"
  local source_counts="$OUTPUT_DIR/source_row_counts.csv"
  local target_counts="$OUTPUT_DIR/target_row_counts.csv"
  local source_invalid_constraints="$OUTPUT_DIR/source_invalid_constraints.csv"
  local target_invalid_constraints="$OUTPUT_DIR/target_invalid_constraints.csv"
  local source_spot_checks="$OUTPUT_DIR/source_spot_checks.csv"
  local target_spot_checks="$OUTPUT_DIR/target_spot_checks.csv"

  local table_diff="$OUTPUT_DIR/table_list.diff"
  local count_diff="$OUTPUT_DIR/row_counts.diff"
  local spot_diff="$OUTPUT_DIR/spot_checks.diff"

  log "Collecting source and target verification snapshots"
  run_source_csv "$source_tables" "$QUERY_TABLE_LIST"
  run_target_csv "$target_tables" "$QUERY_TABLE_LIST"

  run_source_csv "$source_counts" "$QUERY_ROW_COUNTS"
  run_target_csv "$target_counts" "$QUERY_ROW_COUNTS"

  run_source_csv "$source_invalid_constraints" "$QUERY_INVALID_CONSTRAINTS"
  run_target_csv "$target_invalid_constraints" "$QUERY_INVALID_CONSTRAINTS"

  run_source_csv "$source_spot_checks" "$QUERY_SPOT_CHECKS"
  run_target_csv "$target_spot_checks" "$QUERY_SPOT_CHECKS"

  local failed=0

  if compare_csv "$source_tables" "$target_tables" "$table_diff"; then
    log "Table list parity: PASS"
    rm -f "$table_diff"
  else
    log "Table list parity: FAIL ($table_diff)"
    failed=1
  fi

  if compare_csv "$source_counts" "$target_counts" "$count_diff"; then
    log "Per-table row counts: PASS"
    rm -f "$count_diff"
  else
    log "Per-table row counts: FAIL ($count_diff)"
    failed=1
  fi

  if compare_csv "$source_spot_checks" "$target_spot_checks" "$spot_diff"; then
    log "Spot-check table counts: PASS"
    rm -f "$spot_diff"
  else
    log "Spot-check table counts: FAIL ($spot_diff)"
    failed=1
  fi

  local target_invalid_count=0
  if [[ -f "$target_invalid_constraints" ]]; then
    target_invalid_count=$(( $(wc -l < "$target_invalid_constraints") - 1 ))
  fi

  if (( target_invalid_count == 0 )); then
    log "Constraint validation state: PASS"
  else
    log "Constraint validation state: FAIL (${target_invalid_count} invalid constraints in target)"
    failed=1
  fi

  printf "\nVerification artifacts\n"
  printf -- "- %s\n" "$OUTPUT_DIR"
  printf -- "- %s\n" "$source_tables"
  printf -- "- %s\n" "$target_tables"
  printf -- "- %s\n" "$source_counts"
  printf -- "- %s\n" "$target_counts"
  printf -- "- %s\n" "$target_invalid_constraints"

  if (( failed != 0 )); then
    fail "Supabase transfer verification failed"
  fi

  log "Supabase transfer verification passed"
}

main "$@"
