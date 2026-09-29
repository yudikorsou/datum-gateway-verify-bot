# Run the DATUM Gateway bots 24/7 on Umbrel

Both bots are Node processes. They stay up on Umbrel as Docker containers with `restart: unless-stopped`, so they come back after a reboot, a crash, or a Portainer restart. Named volumes keep the SQLite databases.

Stop `npm start` on your Mac first. Discord and Telegram only allow one login per bot token.

## 1. Copy the code onto the Umbrel

SSH in (Settings → Advanced → enable SSH, then `ssh umbrel@umbrel.local`).

```bash
mkdir -p ~/datum-bots
cd ~/datum-bots
git clone https://github.com/yudikorsou/datum-gateway-verify-bot.git
git clone https://github.com/yudikorsou/datum-gateway-telegram-verify-bot.git
```

If `git clone` on the Umbrel is missing Docker files, copy the folders from this Mac. After this commit they are on GitHub.

## 2. Fill secrets

```bash
cp datum-gateway-verify-bot/deploy/umbrel/.env.example datum-gateway-verify-bot/deploy/umbrel/.env
nano datum-gateway-verify-bot/deploy/umbrel/.env
```

Paste the same Discord and Telegram values you already use locally.

## 3. Start both bots

Umbrel includes Docker. From the Umbrel:

```bash
cd ~/datum-bots/datum-gateway-verify-bot/deploy/umbrel
docker compose --env-file .env up -d --build
docker compose logs -f
```

You should see `logged in as DATUM Gateway#…` and `logged in as @…`. Detach with Ctrl+C; the containers keep running.

Optional: copy the existing Discord database so linked miners stay linked:

```bash
docker compose --env-file .env up -d discord
docker cp /path/to/bot.sqlite "$(docker compose ps -q discord)":/data/bot.sqlite
docker compose restart discord
```

## 4. Portainer (optional)

Install **Portainer** from the Umbrel App Store. Create a stack, paste `docker-compose.yml`, set the same environment variables, and use **named volumes** only (not host bind mounts). Set the restart policy to `unless-stopped`.

Uninstalling Portainer deletes stacks it created. The SSH `docker compose` method survives Portainer uninstalls.

## 5. After an Umbrel reboot

Do nothing. Docker starts the containers again. Each bot scans linked miners about 30 seconds after login, then every 24 hours.
