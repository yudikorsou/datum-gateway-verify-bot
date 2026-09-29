# Run the DATUM Gateway bots 24/7 on Umbrel with Portainer

Umbrel’s Portainer app has its own Docker engine. Stacks you create there keep running after an Umbrel reboot **as long as Portainer stays installed**. Use named volumes only. Bind mounts are wiped when Portainer updates.

Stop `npm start` on your Mac first. Each bot token can only be logged in once.

## 1. Install Portainer

1. Open the Umbrel dashboard in a browser (`http://umbrel.local`).
2. Open the **App Store**.
3. Install **Portainer**.
4. Open Portainer from the Umbrel home screen.
5. Log in with the default user shown on first launch, then set your own password.

## 2. Wait for the public images

GitHub builds these images on every push to `main`:

- `ghcr.io/yudikorsou/datum-gateway-verify-bot:latest`
- `ghcr.io/yudikorsou/datum-gateway-telegram-verify-bot:latest`

Open each package on GitHub and set visibility to **Public** the first time (Packages → the image → Package settings → Change visibility).

## 3. Deploy the stack

1. In Portainer, open **Live connect** / the local Docker environment.
2. Go to **Stacks** → **Add stack**.
3. Name it `datum-gateway-bots`.
4. Paste the contents of [docker-compose.portainer.yml](docker-compose.portainer.yml).
5. Under **Environment variables**, add:

| Name | Value |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_GUILD_ID` | Server ID |
| `VERIFIED_ROLE_ID` | DATUM Verified role ID |
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `TELEGRAM_CHAT_ID` | Group chat id |

Leave `SCAN_INTERVAL_HOURS=24` and `CONVOY_TREAT_ACTIVE_AS_DATUM=true` unless you need to change them.

6. Click **Deploy the stack**.
7. Open **Containers**. Both `discord` and `telegram` should be **running**, with restart policy **unless-stopped**.
8. Open **Logs** for each. You want `logged in as DATUM Gateway#…` and `logged in as @…`.

## 4. Keep it running

- Leave the **Portainer** app installed on Umbrel. Stopping or uninstalling Portainer stops these bots and, if you uninstall, can delete their data.
- Do not add host paths like `/home/umbrel/...` as volumes.
- After an Umbrel reboot, Portainer starts, then Docker starts the stack again. Each bot rescans about 30 seconds after login, then every 24 hours.

## SSH compose (alternative)

If you prefer not to use Portainer, clone both repos and run [docker-compose.yml](docker-compose.yml) with `docker compose --env-file .env up -d --build`. That uses Umbrel’s main Docker engine instead of Portainer’s nested Docker.
