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

echo "Restore $DUMP dans Postgres Docker..."
run_sql server/sql/before-restore.sql

if [ -d "$DUMP" ]; then
  echo "Dossier SQL détecté."
  run_sql "$DUMP/schema-public.sql"
  run_sql "$DUMP/schema-storage.sql"
  run_sql "$DUMP/data-public.sql"
  run_sql "$DUMP/data-storage.sql"
  run_sql "$DUMP/auth-users.sql"
elif [ -f "$DUMP" ]; then
  if grep -q "PostgreSQL custom database dump" "$DUMP" 2>/dev/null; then
    docker compose exec -T postgres pg_restore -U humana -d humana --no-owner --no-acl --verbose < "$DUMP" || true
  else
    run_sql "$DUMP"
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
