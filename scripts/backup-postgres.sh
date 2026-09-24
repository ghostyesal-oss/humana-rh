#!/bin/sh
# Dump Postgres chiffré (AES-256) vers /backups, distinct du volume pgdata.
# Restauration : scripts/restore-postgres.sh /backups/humana-XXXX.sql.gz.enc
set -eu

DEST=${BACKUP_DIR:-/backups}
KEEP=${BACKUP_KEEP_DAYS:-14}
INTERVAL=${BACKUP_INTERVAL_SEC:-86400}

dump_once() {
  if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ] || [ "${#BACKUP_ENCRYPTION_KEY}" -lt 16 ]; then
    echo "[backup] ERREUR: BACKUP_ENCRYPTION_KEY manquant (min. 16 caractères). Dump refusé." >&2
    return 1
  fi
  mkdir -p "$DEST"
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  RAW="$DEST/humana-$STAMP.sql.gz"
  ENC="$RAW.enc"
  echo "[backup] dump $STAMP"
  pg_dump --no-owner --no-acl | gzip > "$RAW"
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_KEY -in "$RAW" -out "$ENC"
  rm -f "$RAW"
  echo "[backup] chiffré $ENC"
  if [ -n "${BACKUP_OFFSITE_DIR:-}" ]; then
    mkdir -p "$BACKUP_OFFSITE_DIR"
    cp -a "$ENC" "$BACKUP_OFFSITE_DIR/"
    echo "[backup] copie $BACKUP_OFFSITE_DIR"
  fi
  find "$DEST" -type f -name 'humana-*.sql.gz.enc' -mtime +"$KEEP" -delete 2>/dev/null || true
  if [ -n "${BACKUP_OFFSITE_DIR:-}" ]; then
    find "$BACKUP_OFFSITE_DIR" -type f -name 'humana-*.sql.gz.enc' -mtime +"$KEEP" -delete 2>/dev/null || true
  fi
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
