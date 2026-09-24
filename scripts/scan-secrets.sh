#!/bin/sh
# Signale des motifs de secrets dans les fichiers suivis par git.
set -eu
cd "$(dirname "$0")/.."
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Pas un dépôt git." >&2
  exit 1
fi
echo "Scan des fichiers suivis..."
git grep -nE 'BEGIN (RSA |OPENSSH )?PRIVATE KEY|service_role|sk_live_|xox[baprs]-|eyJhbGciOi' -- \
  ':!.gitignore' ':!*.md' ':!style.css' ':!*.png' ':!*.jpg' ':!*.ico' || true
echo "Fichiers sensibles déjà passés dans l'historique (noms) :"
git log --all --full-history --pretty=format: --name-only -- .env config.js '*.pem' '*.key' | sort -u | grep -v '^$' || true
echo "Terminé. Vérifiez manuellement toute ligne listée."
