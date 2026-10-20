#!/bin/sh
# Import unique d'un dump SQL Supabase vers Postgres Docker.
# Ne pas utiliser en production Daylyx : ça DROP le schéma public.
# Backup chiffré Daylyx : scripts/restore-postgres.sh
set -eu
DUMP=${1:-/opt/humana/bd_dump}

if [ "${ALLOW_LEGACY_DUMP_RESTORE:-}" != "1" ]; then
  echo "Refusé: restore-dump.sh recrée le schéma public (perte des données actuelles)." >&2
  echo "Restauration d'un backup Daylyx: scripts/restore-postgres.sh" >&2
  echo "Import legacy Supabase uniquement: ALLOW_LEGACY_DUMP_RESTORE=1 $0 [dump]" >&2
  exit 1
fi

run_sql() {
  file=$1
  if [ -f "$file" ]; then
    echo ">>> $file"
    docker compose exec -T postgres psql -U humana -d humana -v ON_ERROR_STOP=0 < "$file" || true
  else
    echo ">>> skip (absent): $file"
  fi
}

run_sql_strict() {
  file=$1
  if [ ! -f "$file" ]; then
    echo ">>> skip (absent): $file"
    return 0
  fi
  echo ">>> $file (strict)"
  docker compose exec -T postgres psql -U humana -d humana -v ON_ERROR_STOP=1 < "$file"
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

already_rls=$(docker compose exec -T postgres psql -U humana -d humana -tAc \
  "select 1 from public.schema_migrations where id like '%phase2_rls%' limit 1" 2>/dev/null || true)
already_rls=$(echo "$already_rls" | tr -d '[:space:]')
if [ "$already_rls" = "1" ] && [ "${FORCE_SCHEMA_RESET:-}" != "1" ]; then
  echo "Refusé: la base a déjà la RLS Humana. Ce script effacerait la production." >&2
  echo "Backup Daylyx: scripts/restore-postgres.sh" >&2
  echo "Forcer l'import (perte de données): FORCE_SCHEMA_RESET=1 ALLOW_LEGACY_DUMP_RESTORE=1 $0" >&2
  exit 1
fi

echo "Restore $DUMP dans Postgres Docker..."
echo "Reset du schéma public (données incomplètes d'un essai précédent)..."
docker compose exec -T postgres psql -U humana -d humana -v ON_ERROR_STOP=1 -c \
  "drop schema if exists public cascade; drop schema if exists storage cascade; create schema public; grant all on schema public to humana; grant all on schema public to public;"

run_sql_strict server/sql/before-restore.sql

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

run_sql_strict server/sql/after-restore.sql
echo "Redémarrage API pour appliquer les migrations RLS..."
docker compose restart api
echo "OK. Tables public :"
docker compose exec postgres psql -U humana -d humana -c '\dt public.*'
echo "Aperçu profils :"
docker compose exec postgres psql -U humana -d humana -c 'select email, role from public.profiles order by email limit 20;'
