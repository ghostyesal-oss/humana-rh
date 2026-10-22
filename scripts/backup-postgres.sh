#!/bin/sh
# Dump Postgres + archives du volume storage, chiffrés (AES-256) vers /backups.
# Copie vers /offsite (bind-mount hôte, idéalement un 2e disque OVH).
# Restauration : scripts/restore-postgres.sh
set -eu

DEST=${BACKUP_DIR:-/backups}
KEEP=${BACKUP_KEEP_DAYS:-14}
INTERVAL=${BACKUP_INTERVAL_SEC:-86400}
STORAGE_ROOT=${STORAGE_ROOT:-/data/storage}
OFFSITE=${BACKUP_OFFSITE_DIR:-}

encrypt_copy() {
  raw=$1
  enc=$2
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_KEY -in "$raw" -out "$enc"
  rm -f "$raw"
  echo "[backup] chiffré $enc"
  if [ -n "$OFFSITE" ]; then
    mkdir -p "$OFFSITE"
    cp -a "$enc" "$OFFSITE/"
    echo "[backup] copie $OFFSITE"
  fi
}

dump_once() {
  if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ] || [ "${#BACKUP_ENCRYPTION_KEY}" -lt 16 ]; then
    echo "[backup] ERREUR: BACKUP_ENCRYPTION_KEY manquant (min. 16 caractères). Dump refusé." >&2
    return 1
  fi
  mkdir -p "$DEST"
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)

  RAW="$DEST/humana-$STAMP.sql.gz"
  echo "[backup] dump postgres $STAMP"
  pg_dump --no-owner --no-acl | gzip > "$RAW"
  encrypt_copy "$RAW" "$RAW.enc"

  if [ -d "$STORAGE_ROOT" ]; then
    TAR="$DEST/humana-$STAMP-storage.tar.gz"
    echo "[backup] archive storage $STORAGE_ROOT"
    tar -C "$(dirname "$STORAGE_ROOT")" -czf "$TAR" "$(basename "$STORAGE_ROOT")"
    encrypt_copy "$TAR" "$TAR.enc"
  else
    echo "[backup] storage absent ($STORAGE_ROOT), ignoré"
  fi

  find "$DEST" -type f \( -name 'humana-*.sql.gz.enc' -o -name 'humana-*-storage.tar.gz.enc' \) -mtime +"$KEEP" -delete 2>/dev/null || true
  if [ -n "$OFFSITE" ]; then
    find "$OFFSITE" -type f \( -name 'humana-*.sql.gz.enc' -o -name 'humana-*-storage.tar.gz.enc' \) -mtime +"$KEEP" -delete 2>/dev/null || true
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
