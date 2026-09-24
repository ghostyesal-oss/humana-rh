FROM alpine:3.20
RUN apk add --no-cache curl openssl docker-cli tzdata
COPY scripts/watchdog.sh /watchdog.sh
RUN chmod +x /watchdog.sh
CMD ["/watchdog.sh"]
