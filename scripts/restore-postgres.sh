#!/bin/sh
# Restaure un dump / une archive storage produit par backup-postgres.sh.
# Ne pas utiliser restore-dump.sh : il DROP le schéma et est bloqué hors import legacy.
# Usage:
#   PGPASSWORD=... PGHOST=postgres PGUSER=humana PGDATABASE=humana \
#   BACKUP_ENCRYPTION_KEY=... \
#   ./scripts/restore-postgres.sh /backups/humana-20260924T020000Z.sql.gz.enc
#   STORAGE_ROOT=/data/storage ./scripts/restore-postgres.sh /backups/humana-...-storage.tar.gz.enc
set -eu

FILE=${1:-}
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: $0 chemin/vers/humana-*.sql.gz[.enc] | humana-*-storage.tar.gz[.enc]" >&2
  exit 1
fi

need_key() {
  if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    echo "BACKUP_ENCRYPTION_KEY requis pour un fichier chiffré." >&2
    exit 1
  fi
}

case "$FILE" in
  *-storage.tar.gz.enc)
    need_key
    TARGET=${STORAGE_ROOT:-/data/storage}
    mkdir -p "$(dirname "$TARGET")"
    openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$FILE" | tar -C "$(dirname "$TARGET")" -xzf -
    ;;
  *-storage.tar.gz)
    TARGET=${STORAGE_ROOT:-/data/storage}
    mkdir -p "$(dirname "$TARGET")"
    tar -C "$(dirname "$TARGET")" -xzf "$FILE"
    ;;
  *.sql.gz.enc)
    need_key
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
