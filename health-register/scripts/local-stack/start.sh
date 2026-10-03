#!/usr/bin/env bash
# يشغّل بيئة اختبار محلية تحاكي Supabase (Postgres + GoTrue + PostgREST + بوابة) بلا Docker.
# للاستخدام في التطوير والاختبارات فقط. الاستخدام: bash scripts/local-stack/start.sh [--reset]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
source "$HERE/env.sh"
mkdir -p "$LS_DIR"; cd "$LS_DIR"

PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
if [ ! -x ./postgrest ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.12/postgrest-v12.2.12-linux-static-x86-64.tar.xz | tar xJ
fi
if [ ! -x ./auth/auth ]; then
  mkdir -p auth && curl -sSL https://github.com/supabase/auth/releases/download/v2.180.0/auth-v2.180.0-x86.tar.gz | tar xz -C auth
fi

# إيقاف أي نسخة سابقة حسب المنافذ (البوابة، GoTrue، PostgREST)
fuser -k 54321/tcp 9999/tcp 3000/tcp >/dev/null 2>&1 || true
sleep 1
rm -f keys.json

if [ "${1:-}" = "--reset" ] && [ -d pg/data ]; then
  su postgres -c "$PGBIN/pg_ctl -D $LS_DIR/pg/data stop -m fast" || true
  rm -rf pg storage
fi
if [ ! -d pg/data ]; then
  mkdir -p pg && chown postgres pg
  su postgres -c "$PGBIN/initdb -D $LS_DIR/pg/data -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
  FRESH=1
fi
su postgres -c "$PGBIN/pg_ctl -D $LS_DIR/pg/data -o '-p 54322 -k $LS_DIR/pg -c listen_addresses=127.0.0.1' -l $LS_DIR/pg/log status" >/dev/null 2>&1 || \
  su postgres -c "$PGBIN/pg_ctl -D $LS_DIR/pg/data -o '-p 54322 -k $LS_DIR/pg -c listen_addresses=127.0.0.1' -l $LS_DIR/pg/log start" >/dev/null 2>&1
PSQL="psql -h 127.0.0.1 -p 54322 -U postgres -v ON_ERROR_STOP=1 -q"
if [ "${FRESH:-0}" = 1 ]; then
  $PSQL -f "$HERE/roles.sql"
  ./auth/auth migrate >/dev/null 2>&1
  for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -f "$f"; done
fi
nohup ./auth/auth serve > gotrue.log 2>&1 &
nohup ./postgrest "$HERE/postgrest.conf" > postgrest.log 2>&1 &
(cd "$ROOT" && STORAGE_DIR="$LS_DIR/storage" nohup node_modules/.bin/tsx scripts/local-stack/gateway.ts > "$LS_DIR/gateway.log" 2>&1 &)
for i in $(seq 1 30); do [ -f "$LS_DIR/keys.json" ] && curl -s localhost:54321/auth/v1/health >/dev/null && break; sleep 1; done
ANON=$(node -e "console.log(require('$LS_DIR/keys.json').anon)")
printf 'VITE_SUPABASE_URL=http://localhost:54321\nVITE_SUPABASE_ANON_KEY=%s\n' "$ANON" > "$ROOT/.env.local"
echo "✅ البيئة المحلية تعمل على http://localhost:54321 (وكُتب .env.local)"
