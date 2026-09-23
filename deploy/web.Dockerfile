FROM nginx:1.27-alpine
RUN apk add --no-cache nodejs
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/entrypoint.sh /entrypoint.sh
COPY scripts/generate-config.mjs /opt/humana-config/generate-config.mjs
COPY index.html app.js style.css sw.js boot.js preboot.js humana-client.js manifest.webmanifest /usr/share/nginx/html/
COPY pages /usr/share/nginx/html/pages
COPY *.html /usr/share/nginx/html/
RUN chmod +x /entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
