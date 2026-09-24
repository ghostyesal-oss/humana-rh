#!/bin/sh
# Supervision minimale: disque, santé API, expiration TLS, redémarrage conteneur.
# Alerte: POST texte brut vers ALERT_WEBHOOK_URL (ntfy, Slack incoming, etc.).
# Test: docker compose exec watchdog /watchdog.sh --test
set -eu

INTERVAL=${CHECK_INTERVAL_SEC:-300}
DISK_LIMIT=${DISK_WARN_PCT:-90}
CERT_DAYS=${CERT_WARN_DAYS:-14}

alert() {
  msg=$1
  echo "[watchdog] $msg"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -X POST --data "$msg" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}

if [ "${1:-}" = "--test" ]; then
  alert "Humana watchdog: alerte de test"
  exit 0
fi

origin_host() {
  echo "${APP_ORIGIN:-}" | sed 's#^https://##;s#^http://##;s#/.*##'
}

check_api() {
  if [ -z "${APP_ORIGIN:-}" ]; then
    return 0
  fi
  if ! curl -fsS --max-time 10 "${APP_ORIGIN%/}/api/health" >/dev/null; then
    alert "Humana: API injoignable (${APP_ORIGIN}/api/health)"
  fi
}

check_disk() {
  target=/
  if [ -d /host ]; then
    target=/host
  fi
  pct=$(df -P "$target" | awk 'NR==2 { gsub(/%/, "", $5); print $5 }')
  if [ -n "$pct" ] && [ "$pct" -ge "$DISK_LIMIT" ]; then
    alert "Humana: espace disque ${pct}% (seuil ${DISK_LIMIT}%)"
  fi
}

check_cert() {
  case "${APP_ORIGIN:-}" in
    https://*) ;;
    *) return 0 ;;
  esac
  host=$(origin_host)
  [ -n "$host" ] || return 0
  seconds=$(( CERT_DAYS * 86400 ))
  if ! echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -checkend "$seconds" >/dev/null 2>&1; then
    alert "Humana: certificat TLS expire dans moins de ${CERT_DAYS} jours ($host)"
  fi
}

watch_docker() {
  if [ ! -S /var/run/docker.sock ]; then
    return 0
  fi
  docker events --filter event=die --filter event=oom --filter event=restart --format '{{.Time}} {{.Actor.Attributes.name}} {{.Status}}' 2>/dev/null | while read -r line; do
    echo "$line" | grep -qi 'humana' || continue
    alert "Humana conteneur: $line"
  done
}

watch_docker &

sleep 15
while true; do
  check_api || true
  check_disk || true
  check_cert || true
  sleep "$INTERVAL"
done
