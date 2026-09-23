#!/bin/sh
set -eu
DUMP=${1:-/opt/humana/bd_dump}

run_sql() {
  file=$1
  if [ -f "$file" ]; then
    echo ">>> $file"
    docker compose exec -T postgres psql -U humana -d humana -v ON_ERROR_STOP=0 < "$file" || true
  else
    echo ">>> skip (absent): $file"
  fi
}

run_data() {
  file=$1
  if [ -f "$file" ]; then
    echo ">>> $file (triggers off)"
    { echo "SET session_replication_role = replica;"; cat "$file"; echo "SET session_replication_role = origin;"; } \
      | docker compose exec -T postgres psql -U humana -d humana -v ON_ERROR_STOP=0 || true
  else
    echo ">>> skip (absent): $file"
  fi
}

echo "Restore $DUMP dans Postgres Docker..."
echo "Reset du schéma public (données incomplètes d'un essai précédent)..."
docker compose exec -T postgres psql -U humana -d humana -v ON_ERROR_STOP=0 -c "drop schema if exists public cascade; drop schema if exists storage cascade; create schema public; grant all on schema public to humana; grant all on schema public to public;" || true

run_sql server/sql/before-restore.sql

if [ -d "$DUMP" ]; then
  echo "Dossier SQL détecté."
  run_sql "$DUMP/schema-public.sql"
  run_sql server/sql/drop-auth-fks.sql
  run_sql "$DUMP/schema-storage.sql"
  run_sql server/sql/drop-auth-fks.sql
  run_data "$DUMP/data-public.sql"
  run_data "$DUMP/data-storage.sql"
  echo ">>> skip auth-users.sql (SSO Microsoft, pas Supabase Auth)"
elif [ -f "$DUMP" ]; then
  if grep -q "PostgreSQL custom database dump" "$DUMP" 2>/dev/null; then
    docker compose exec -T postgres pg_restore -U humana -d humana --no-owner --no-acl --verbose < "$DUMP" || true
  else
    run_data "$DUMP"
  fi
else
  echo "Fichier ou dossier introuvable: $DUMP"
  exit 1
fi

run_sql server/sql/after-restore.sql
echo "OK. Tables public :"
docker compose exec postgres psql -U humana -d humana -c '\dt public.*'
echo "Aperçu profils :"
docker compose exec postgres psql -U humana -d humana -c 'select email, role from public.profiles order by email limit 20;'
