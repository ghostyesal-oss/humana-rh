FROM caddy:2.8-alpine
RUN apk add --no-cache nodejs
COPY deploy/Caddyfile.selfhost /etc/caddy/Caddyfile
COPY deploy/caddy-entrypoint.sh /entrypoint.sh
COPY scripts/generate-config.mjs /opt/humana-config/generate-config.mjs
COPY index.html app.js style.css sw.js boot.js preboot.js humana-client.js manifest.webmanifest /srv/
COPY pages /srv/pages
COPY *.html /srv/
RUN chmod +x /entrypoint.sh
EXPOSE 80 443
ENTRYPOINT ["/entrypoint.sh"]
