#!/bin/sh
# Restaure un dump produit par backup-postgres.sh (policies RLS conservées).
# Ne pas utiliser restore-dump.sh : il DROP le schéma et est bloqué hors import legacy.
# Usage:
#   PGPASSWORD=... PGHOST=postgres PGUSER=humana PGDATABASE=humana \
#   BACKUP_ENCRYPTION_KEY=... \
#   ./scripts/restore-postgres.sh /backups/humana-20260924T020000Z.sql.gz.enc
set -eu

FILE=${1:-}
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: $0 chemin/vers/humana-*.sql.gz[.enc]" >&2
  exit 1
fi

case "$FILE" in
  *.sql.gz.enc)
    if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
      echo "BACKUP_ENCRYPTION_KEY requis pour un dump chiffré." >&2
      exit 1
    fi
    openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$FILE" | gunzip | psql
    ;;
  *.sql.gz)
    gunzip -c "$FILE" | psql
    ;;
  *.sql)
    psql -f "$FILE"
    ;;
  *)
    echo "Extension non reconnue: $FILE" >&2
    exit 1
    ;;
esac

echo "[restore] terminé"
