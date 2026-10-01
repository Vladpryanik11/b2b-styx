# STYX B2B: кабинет клиента, кабинет менеджера и API в одном процессе Node.js.
# База SQLite и резервные копии — в томе /app/data (его нужно сохранять между обновлениями).
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/app/data/styx.sqlite \
    BACKUP_DIR=/app/data/backups \
    TRUST_PROXY=1 \
    COOKIE_SECURE=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/session >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
