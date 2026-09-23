#!/bin/sh
set -eu
cd /opt/humana-config
node generate-config.mjs
cp config.js /usr/share/nginx/html/config.js
exec nginx -g "daemon off;"
