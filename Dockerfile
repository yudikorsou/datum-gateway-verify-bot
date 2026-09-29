FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY docs/signature-explainer/prove-your-address.mp4 ./assets/prove-your-address.mp4

ENV NODE_ENV=production \
    DATABASE_PATH=/data/bot.sqlite

RUN mkdir -p /data

CMD ["node", "src/index.js"]
