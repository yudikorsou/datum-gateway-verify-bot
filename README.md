# DATUM Gateway verification bot

Telegram bot for miners who build their own block templates with [DATUM Gateway](https://github.com/luke-jr/datum_gateway). A Telegram user gets into the community only after both of these are true:

1. They sign a fresh message with the key for a public Bitcoin address. Shrike and other BTCB2 wallets are included: their payout addresses are ordinary mainnet `1…`, `3…`, `bc1q…`, and `bc1p…` addresses.
2. That address is submitting shares through a DATUM Gateway on a pool that publishes miner stats.

The bot asks for those two proofs separately. Ownership comes first. The DATUM check starts only after the signature matches.

Every 24 hours the bot checks again. Access stays while a pool still shows fresh DATUM shares. Access is removed only when every pool answers and none of them do. A pool that is down does not remove anyone.

Telegram communities do not have Discord-style roles. Access here means membership in the configured chat. When the daily scan fails, the bot kicks that member. They can run `/verify` again and rejoin once shares are showing.

Anyone can run a copy for their own community. The bot token and chat id stay in a local `.env` file and are never committed. Node.js 22 or newer is required.

```bash
git clone https://github.com/yudikorsou/datum-gateway-verify-bot.git
cd datum-gateway-verify-bot
npm install
cp .env.example .env
npm test
npm start
```

## What the pools actually publish

| Pool | Stats used | Counts as DATUM |
| --- | --- | --- |
| [CONVOY](https://convoy.xyz/) | Worker table for the address | An online worker, or a worker timestamp inside the freshness window. CONVOY’s published setup is a DATUM Gateway (`datum-beta1.mine.convoy.xyz:28915`). The public table does not print a separate DATUM flag. Set `CONVOY_TREAT_ACTIVE_AS_DATUM=false` to stop this pool from granting access. |
| [OmegaPool](https://omegapool.tech/) | `https://omegapool.tech/stats.json` | `own_gateway_work` above zero and live hashrate. The pool’s own public gateway does not count. |
| [RIPTide](https://riptide.maveth.ca/) | `GET /api/user/{address}` | A worker with `connection_type: datum` and live hashrate. Stratum V1 does not count. |
| [Lazarus Pool](https://pool.awokenlazarus.xyz/) | `GET https://pool.lazarus-xbt.xyz/api/miner/{address}` | `fee_path: datum` or `via: prime`, and a last share inside the freshness window. Public stratum does not count. |
| [Blockvase](https://blockvase.com/#pool) | `GET https://blockvase.com/api/pool` | Miner `kind` of `datum`, or `mixed` with DATUM work, plus live hashrate. `sv1` does not count. |
| [Paperclip Pool](https://pool.paperclippool.xyz/) | `GET /api/status` | `datum_work` above zero and live hashrate. Stratum-only window work does not count. |
| [B2Pool](https://b2pool.io/start#datum) | `GET /api/v1/miner/{address}` | Never. The API shows shares and hashrate, but not whether they came from a DATUM Gateway or from public stratum. The bot reports the activity and does not grant access from it. |

Shrike is a Sparrow wallet that follows Bitcoin’s BLAKE2b proof-of-work change. It does not use a new address format. Payout addresses are still mainnet `1…`, `3…`, `bc1q…`, and `bc1p…`, and those are what the pools list. The bot checks those the same way it checks any other Bitcoin address. `SIGHASH_UNIFIED` is how Shrike signs spending transactions so they are not replayable. This bot does not ask for a transaction signature. It asks for the message signature already in Shrike under **Tools → Sign/Verify Message**.

## Telegram setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token into `TELEGRAM_BOT_TOKEN`.
2. Add the bot to the community and promote it to admin. It needs **Invite users via link** and **Ban users**.
3. In the community, send `/chatid`. Put that number in `TELEGRAM_CHAT_ID`. Supergroup ids look like `-100…`.
4. Optional: turn on **Approve new members**. The bot approves a waiting request after both checks pass. Without that setting, it sends a one-time invite link instead.

```bash
npm install
npm test
npm start
```

Commands:

- `/verify` starts the flow in a private chat with the bot. `/start` does the same.
- `/status` shows the linked address and the last scan.
- `/unlink` removes the address and kicks the member from the community.
- `/cancel` drops an unfinished proof.
- `/chatid` replies with the current chat id. Run it inside the community while setting up.

Do the proof in the private chat. The bot will not take an address or a signature posted in the community.

## Member flow

1. Open the bot and send `/verify`, then send the payout address. Do not include a `.worker` suffix.
2. Sign the exact message the bot shows.
   - Shrike or Sparrow: **Tools → Sign/Verify Message**
   - Bitcoin Core: `signmessage "<address>" "<message>"`
   - Electrum: **Tools → Sign/Verify message**
   - Taproot (`bc1p…`) needs BIP322. Legacy and SegWit can use the classic Bitcoin signed message. A full signed-message block is accepted as well as the raw base64 signature.
3. Paste the signature. The bot checks it and stops there. Pools are not queried yet.
4. Tap **Check DATUM shares**. The bot queries the pools above.
5. If both checks pass, the bot approves a pending join request or sends a one-time invite.

The signed message includes the Telegram user id, the address, and a nonce. It expires after 30 minutes. An address can only be linked to one Telegram user.

If someone requests to join before they have verified, the bot stores the request and asks them to open the private chat and send `/verify`. A member who already has access is approved immediately.

## Recheck

`SCAN_INTERVAL_HOURS` defaults to 24. The bot also scans about 30 seconds after it logs in, so a restart does not wait a full day. `SHARE_MAX_AGE_HOURS` is how old a last-share timestamp can be. Pools that only publish hashrate count a positive hashrate as fresh, because that figure is already a short rolling window.

When the scan is conclusive and no pool shows fresh DATUM shares, the bot kicks the member and messages them. They can send `/verify` again once shares are showing up. A pool that does not answer is skipped, and access stays.

## License

MIT. See [LICENSE](LICENSE).
