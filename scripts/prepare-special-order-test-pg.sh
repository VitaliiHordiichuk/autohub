#!/usr/bin/env bash
# Creates an entirely SEPARATE PostgreSQL 16 cluster, not production 5432.
# No TXT rows are imported and no active source pointer is updated.
set -Eeuo pipefail
umask 077

EXPECTED_USER="ubuntu"
BASE="/home/ubuntu/maka-special-order/isolated-pg16-20261105"
DATA="$BASE/data"
SOCKET="$BASE/socket"
PORT="5545"
DATABASE="maka_special_order_preview"
BIN="/usr/lib/postgresql/16/bin"
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
MIGRATION="$SCRIPT_DIR/../migrations/125_special_order_txt_fallback.sql"

echo "=== SAFE ISOLATED CLUSTER PRECHECK ==="
test "$(id -un)" = "$EXPECTED_USER"
test "$HOME" = "/home/ubuntu"
test -d /home/ubuntu/maka-special-order
test -f "$MIGRATION"
test ! -e "$BASE"
test -x "$BIN/initdb"
test -x "$BIN/pg_ctl"
test -x "$BIN/psql"
test -x "$BIN/createdb"
! ss -ltn "( sport = :$PORT )" | grep -q LISTEN

AVAILABLE_BYTES="$(df -B1 --output=avail /home/ubuntu/maka-special-order | tail -1 | tr -d ' ')"
test "$AVAILABLE_BYTES" -gt 10737418240

echo "Creating private test-cluster folder and password"
mkdir -m 700 "$BASE"
mkdir -m 700 "$SOCKET"
python3 -c 'import secrets; print(secrets.token_urlsafe(48))' > "$BASE/admin-password"
chmod 600 "$BASE/admin-password"

echo "=== INITDB TEST CLUSTER ONLY ==="
"$BIN/initdb" \
  --pgdata="$DATA" \
  --username="$EXPECTED_USER" \
  --encoding=UTF8 \
  --no-locale \
  --data-checksums \
  --auth-local=peer \
  --auth-host=scram-sha-256 \
  --pwfile="$BASE/admin-password" >"$BASE/initdb.log" 2>&1 || {
    tail -50 "$BASE/initdb.log"
    exit 1
  }

echo "=== START ISOLATED POSTGRESQL 127.0.0.1:$PORT ==="
"$BIN/pg_ctl" -D "$DATA" -l "$BASE/server.log" \
  -o "-c port=$PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$SOCKET -c shared_buffers=128MB -c work_mem=8MB -c maintenance_work_mem=128MB -c max_connections=20 -c max_parallel_workers=1" \
  -w start

psql_local() {
  "$BIN/psql" -h "$SOCKET" -p "$PORT" -U "$EXPECTED_USER" -X \
    -v ON_ERROR_STOP=1 "$@"
}

ACTUAL_DIR="$(psql_local -d postgres -Atc "SHOW data_directory")"
ACTUAL_PORT="$(psql_local -d postgres -Atc "SHOW port")"
test "$ACTUAL_DIR" = "$DATA"
test "$ACTUAL_PORT" = "$PORT"

echo "=== CREATE EMPTY TEST DATABASE AND ROLES ==="
psql_local -d postgres -c 'CREATE ROLE autohub_app NOLOGIN;'
"$BIN/createdb" -h "$SOCKET" -p "$PORT" -U "$EXPECTED_USER" \
  -E UTF8 -T template0 "$DATABASE"
psql_local -d "$DATABASE" -c 'CREATE TABLE schema_migrations (version text PRIMARY KEY);'

echo "=== APPLY MIGRATION 125 TO TEST DB ONLY ==="
psql_local -d "$DATABASE" -f "$MIGRATION"

echo "=== CHECK TEST CLUSTER FINGERPRINT ==="
PGPASSWORD="$(cat "$BASE/admin-password")" \
"$BIN/psql" -h 127.0.0.1 -p "$PORT" -U "$EXPECTED_USER" \
  -X -v ON_ERROR_STOP=1 -d "$DATABASE" <<'SQL'
SELECT current_database() AS database,
       current_setting('port') AS port,
       current_setting('data_directory') AS data_directory;
SELECT version FROM schema_migrations
 WHERE version = '125_special_order_txt_fallback';
SELECT to_regclass('public.special_order_entries') AS entries,
       to_regclass('public.special_order_import_runs') AS import_runs,
       to_regclass('public.special_order_sources') AS sources;
SELECT COUNT(*) AS staged_entries FROM special_order_entries;
SELECT COUNT(*) AS active_sources FROM special_order_sources
 WHERE active_import_id IS NOT NULL;
SQL

echo "==============================================="
echo "ISOLATED POSTGRESQL SETUP SUCCESS"
echo "PGDATA=$DATA"
echo "PORT=$PORT"
echo "DB=$DATABASE"
echo "NO TXT IMPORT; PRODUCTION CLUSTER UNCHANGED"
echo "==============================================="
