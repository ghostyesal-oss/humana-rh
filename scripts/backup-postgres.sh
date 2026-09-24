#!/bin/sh
# Dump Postgres chiffré (AES-256) vers /backups, distinct du volume pgdata.
# Restauration : scripts/restore-postgres.sh /backups/humana-XXXX.sql.gz.enc
set -eu

DEST=${BACKUP_DIR:-/backups}
KEEP=${BACKUP_KEEP_DAYS:-14}
INTERVAL=${BACKUP_INTERVAL_SEC:-86400}

dump_once() {
  mkdir -p "$DEST"
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  RAW="$DEST/humana-$STAMP.sql.gz"
  echo "[backup] dump $STAMP"
  pg_dump --no-owner --no-acl | gzip > "$RAW"
  if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_KEY -in "$RAW" -out "$RAW.enc"
    rm -f "$RAW"
    echo "[backup] chiffré $RAW.enc"
  else
    echo "[backup] ATTENTION: BACKUP_ENCRYPTION_KEY vide, dump en clair."
  fi
  if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
    echo "[backup] copie hors volume: $BACKUP_OFFSITE_CMD"
    sh -c "$BACKUP_OFFSITE_CMD"
  fi
  find "$DEST" -type f \( -name 'humana-*.sql.gz' -o -name 'humana-*.sql.gz.enc' \) -mtime +"$KEEP" -delete 2>/dev/null || true
}

if [ "${1:-}" = "--loop" ]; then
  apk add --no-cache openssl >/dev/null 2>&1 || true
  sleep 20
  while true; do
    dump_once || echo "[backup] échec du dump"
    sleep "$INTERVAL"
  done
fi

dump_once
