#!/bin/sh
set -eu
cd /opt/humana-config
node generate-config.mjs
cp config.js /srv/config.js
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
