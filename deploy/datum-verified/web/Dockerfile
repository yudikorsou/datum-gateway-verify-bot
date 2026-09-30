FROM node:22-bookworm-slim

WORKDIR /app
COPY server.mjs icon.png ./

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

RUN mkdir -p /data && chown -R 1000:1000 /app /data
USER 1000:1000
EXPOSE 8080

CMD ["node", "server.mjs"]
