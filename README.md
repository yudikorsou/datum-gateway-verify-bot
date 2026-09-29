# DATUM Gateway verification bot

Discord bot for miners who build their own block templates with [DATUM Gateway](https://github.com/luke-jr/datum_gateway). A member gets a role only after both of these are true:

1. They sign a fresh message with the key for a public Bitcoin address.
2. That address is submitting shares through a DATUM Gateway on a pool that publishes miner stats.

Every 24 hours the bot checks again. The role stays while a pool still shows fresh DATUM shares. The role is removed only when every pool answers and none of them do. A pool that is down does not strip the role.

Anyone can run a copy on their own Discord server. The bot token, server id, and role id stay in a local `.env` file and are never committed.

```bash
git clone https://github.com/yudikorsou/datum-gateway-verify-bot.git
cd datum-gateway-verify-bot
npm install
cp .env.example .env
npm test
npm start
```

## Run 24/7 on Umbrel

Install **Portainer** from the Umbrel App Store and deploy [deploy/umbrel/docker-compose.portainer.yml](deploy/umbrel/docker-compose.portainer.yml). Full steps: [deploy/umbrel/README.md](deploy/umbrel/README.md).

## What the pools actually publish

| Pool | Stats used | Counts as DATUM |
| --- | --- | --- |
| [CONVOY](https://convoy.xyz/) | Worker table for the address | An online worker, or a worker timestamp inside the freshness window. CONVOY’s published setup is a DATUM Gateway (`datum-beta1.mine.convoy.xyz:28915`). The public table does not print a separate DATUM flag. Set `CONVOY_TREAT_ACTIVE_AS_DATUM=false` to stop this pool from granting the role. |
| [OmegaPool](https://omegapool.tech/) | `https://omegapool.tech/stats.json` | `own_gateway_work` above zero and live hashrate. The pool’s own public gateway does not count. |
| [RIPTide](https://riptide.maveth.ca/) | `GET /api/user/{address}` | A worker with `connection_type: datum` and live hashrate. Stratum V1 does not count. |
| [Lazarus Pool](https://pool.awokenlazarus.xyz/) | `GET https://pool.lazarus-xbt.xyz/api/miner/{address}` | `fee_path: datum` or `via: prime`, and a last share inside the freshness window. Public stratum does not count. |
| [Blockvase](https://blockvase.com/#pool) | `GET https://blockvase.com/api/pool` | Miner `kind` of `datum`, or `mixed` with DATUM work, plus live hashrate. `sv1` does not count. |
| [Paperclip Pool](https://pool.paperclippool.xyz/) | `GET /api/status` | `datum_work` above zero and live hashrate. Stratum-only window work does not count. |
| [B2Pool](https://b2pool.io/start#datum) | `GET /api/v1/miner/{address}` | Never. The API shows shares and hashrate, but not whether they came from a DATUM Gateway or from public stratum. The bot reports the activity and does not grant the role from it. |

Shrike is a Sparrow wallet that follows Bitcoin’s BLAKE2b proof-of-work change. It does not use a new address format. Payout addresses are still mainnet `1…`, `3…`, `bc1q…`, and `bc1p…`, and those are what the pools list. `SIGHASH_UNIFIED` is how Shrike signs spending transactions so they are not replayable. This bot does not ask for a transaction signature. It asks for the message signature already in Shrike under **Tools → Sign/Verify Message**.

## Discord setup

1. Create an application and a bot at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot → Privileged Gateway Intents**, leave the privileged intents off. The bot changes roles with the HTTP API, so it does not need the members intent.
3. Invite the bot from the Developer Portal, which builds a link that matches this application. Open your application, then **OAuth2 → URL Generator**. Check the scopes `bot` and `applications.commands`. If an integration type appears, choose **Guild Install**. Under **Bot Permissions**, check **Manage Roles**. Copy the generated URL at the bottom of the page and open it. A pasted example link returns “invalid form body” when this application is not configured for that install type.
4. Create the miner role. In the server role list, drag the bot’s role **above** that role.
5. Copy `.env.example` to `.env` and fill in the token, application id, server id, and role id.

```bash
npm install
npm test
npm start
```

Commands are registered in `DISCORD_GUILD_ID` on startup:

- `/verify` starts the flow. You can also pass `address` on the command.
- `/status` shows the linked address and the last scan.
- `/unlink` removes the address and the role.

The bot replies ephemerally, so the signature is not posted in the channel.

## Member flow

1. Run `/verify` and enter the payout address. Do not include a `.worker` suffix.
2. Sign the exact message the bot shows. [Watch the explainer](docs/signature-explainer/prove-your-address.mp4) (Shrike, Bitcoin Core, and Electrum).
   - Shrike or Sparrow: **Tools → Sign/Verify Message**
   - Bitcoin Core: `signmessage "<address>" "<message>"`
   - Electrum: **Tools → Sign/Verify message**
   - Taproot (`bc1p…`) needs BIP322. Legacy and SegWit can use the classic Bitcoin signed message. A full signed-message block is accepted as well as the raw base64 signature.
3. Submit the signature. The bot checks the signature, then queries the pools above.
4. If both checks pass, it assigns `VERIFIED_ROLE_ID`.
5. If the role is removed, or someone is kicked and later rejoins, `/verify` gives them a new message to sign in Shrike. They can sign the same wallet again, restore the role while that address still has DATUM shares, or enter a different public address. An older signature does not match the new message.

The signed message includes the Discord user id, the address, and a nonce. It expires after 30 minutes. An address can only be linked to one Discord user.

## Recheck

`SCAN_INTERVAL_HOURS` defaults to 24. The bot also scans about 30 seconds after it logs in, so a restart does not wait a full day. `SHARE_MAX_AGE_HOURS` is how old a last-share timestamp can be. Pools that only publish hashrate count a positive hashrate as fresh, because that figure is already a short rolling window.

If the role disappears, the member can run `/verify` again once shares are showing up.

## License

MIT. See [LICENSE](LICENSE).
