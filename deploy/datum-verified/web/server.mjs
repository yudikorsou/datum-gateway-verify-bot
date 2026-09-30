import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR || '/data'
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const PORT = Number(process.env.PORT || 8080)
const DEFAULT_WEBAPP = 'https://yudikorsou.github.io/datum-gateway-telegram-verify-bot/'
const DISCORD_INVITE_PERMISSIONS = '2415996096'

const DEFAULTS = {
  DISCORD_ENABLED: '0',
  DISCORD_TOKEN: '',
  DISCORD_CLIENT_ID: '',
  DISCORD_GUILD_ID: '',
  VERIFIED_ROLE_ID: '',
  TELEGRAM_ENABLED: '0',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',
  WEBAPP_URL: DEFAULT_WEBAPP,
  SCAN_INTERVAL_HOURS: '24',
  SHARE_MAX_AGE_HOURS: '24',
  CONVOY_TREAT_ACTIVE_AS_DATUM: 'true',
}

const SECRET_KEYS = new Set(['DISCORD_TOKEN', 'TELEGRAM_BOT_TOKEN'])

function ensureDataDir() {
  fs.mkdirSync(path.join(DATA_DIR, 'discord'), { recursive: true })
  fs.mkdirSync(path.join(DATA_DIR, 'telegram'), { recursive: true })
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function writeSettings(next) {
  ensureDataDir()
  const tmp = `${SETTINGS_FILE}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
  fs.renameSync(tmp, SETTINGS_FILE)
}

function maskSecret(value) {
  const text = String(value || '')
  if (!text) return ''
  if (text.length <= 8) return '••••'
  return `${text.slice(0, 4)}…${text.slice(-4)}`
}

function publicSettings(settings) {
  const out = { ...settings }
  for (const key of SECRET_KEYS) out[key] = maskSecret(settings[key])
  out.discordTokenSet = Boolean(settings.DISCORD_TOKEN)
  out.telegramTokenSet = Boolean(settings.TELEGRAM_BOT_TOKEN)
  if (settings.DISCORD_CLIENT_ID) {
    const params = new URLSearchParams({
      client_id: settings.DISCORD_CLIENT_ID,
      permissions: DISCORD_INVITE_PERMISSIONS,
      integration_type: '0',
      scope: 'bot applications.commands',
    })
    out.discordInviteUrl = `https://discord.com/oauth2/authorize?${params}`
  } else {
    out.discordInviteUrl = ''
  }
  return out
}

async function probeDiscord(token) {
  if (!token) return { ok: false, detail: 'No Discord token saved yet.' }
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      return { ok: false, detail: `Discord returned HTTP ${response.status}. Check the bot token.` }
    }
    const me = await response.json()
    const name = me.discriminator && me.discriminator !== '0' ? `${me.username}#${me.discriminator}` : me.username
    return { ok: true, detail: `Logged in as ${name}` }
  } catch (error) {
    return { ok: false, detail: `Could not reach Discord: ${error.message}` }
  }
}

async function probeTelegram(token) {
  if (!token) return { ok: false, detail: 'No Telegram token saved yet.' }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(8000),
    })
    const body = await response.json().catch(() => ({}))
    if (!body.ok) {
      return { ok: false, detail: body.description || `Telegram returned HTTP ${response.status}. Check the bot token.` }
    }
    return { ok: true, detail: `Logged in as @${body.result.username}` }
  } catch (error) {
    return { ok: false, detail: `Could not reach Telegram: ${error.message}` }
  }
}

function mergeSettings(current, incoming) {
  const next = { ...current }
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue
    let value = incoming[key]
    if (value === true) value = 'true'
    if (value === false) value = 'false'
    if (value === undefined || value === null) continue
    value = String(value).trim()
    if (SECRET_KEYS.has(key) && (!value || value.includes('…') || value === '••••')) continue
    if (key.endsWith('_ENABLED')) next[key] = value === '1' || value === 'true' || value === 'on' ? '1' : '0'
    else next[key] = value
  }
  if (!next.WEBAPP_URL) next.WEBAPP_URL = DEFAULT_WEBAPP
  if (!next.SCAN_INTERVAL_HOURS) next.SCAN_INTERVAL_HOURS = '24'
  if (!next.SHARE_MAX_AGE_HOURS) next.SHARE_MAX_AGE_HOURS = '24'
  if (next.CONVOY_TREAT_ACTIVE_AS_DATUM !== 'false') next.CONVOY_TREAT_ACTIVE_AS_DATUM = 'true'
  return next
}

function send(response, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DATUMVerified</title>
  <style>
    :root {
      --bg: #0b0d12;
      --panel: #141821;
      --line: #2a3140;
      --text: #eef2f8;
      --muted: #93a0b5;
      --amber: #f5a623;
      --amber-dim: rgba(245, 166, 35, 0.14);
      --ok: #3dd68c;
      --bad: #ff6b6b;
      --discord: #5865f2;
      --telegram: #2aa1c7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      background:
        radial-gradient(1200px 500px at 10% -10%, rgba(245, 166, 35, 0.12), transparent 50%),
        var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    main { max-width: 880px; margin: 0 auto; padding: 32px 20px 80px; }
    header { display: flex; gap: 16px; align-items: center; margin-bottom: 28px; }
    .mark {
      width: 56px; height: 56px; border-radius: 16px;
      overflow: hidden;
      background: #fff;
      box-shadow: 0 10px 30px rgba(245, 166, 35, 0.18);
    }
    .mark img { width: 100%; height: 100%; display: block; }
    h1 { margin: 0; font-size: 28px; letter-spacing: -0.03em; }
    .tagline { margin: 4px 0 0; color: var(--muted); }
    .banner {
      background: var(--amber-dim);
      border: 1px solid rgba(245, 166, 35, 0.35);
      border-radius: 14px;
      padding: 14px 16px;
      color: #ffd78a;
      margin-bottom: 22px;
    }
    .grid { display: grid; gap: 18px; }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 22px;
    }
    h2 { margin: 0 0 6px; font-size: 18px; }
    .hint { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 0 0 16px; }
    label { display: block; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin: 14px 0 6px; }
    input, select {
      width: 100%;
      background: #0d1118;
      border: 1px solid var(--line);
      border-radius: 10px;
      color: var(--text);
      padding: 11px 12px;
      font: inherit;
    }
    input:focus { outline: 2px solid rgba(245, 166, 35, 0.55); border-color: var(--amber); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .toggle { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .toggle input { width: auto; }
    .status {
      margin-top: 14px;
      padding: 10px 12px;
      border-radius: 10px;
      background: #0d1118;
      color: var(--muted);
      font-size: 14px;
    }
    .status.ok { color: var(--ok); }
    .status.bad { color: var(--bad); }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; }
    button {
      appearance: none;
      border: 0;
      border-radius: 12px;
      padding: 12px 18px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      background: var(--amber);
      color: #1a1204;
    }
    button.secondary { background: transparent; color: var(--text); border: 1px solid var(--line); }
    a { color: var(--amber); }
    ol { margin: 8px 0 0; padding-left: 18px; color: var(--muted); }
    li { margin: 6px 0; }
    .flash { display: none; margin-top: 12px; color: var(--ok); }
    @media (max-width: 700px) { .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="mark"><img src="/icon.png" alt="DATUMVerified"></div>
      <div>
        <h1>DATUMVerified</h1>
        <p class="tagline">Run Discord and Telegram DATUM Gateway verify bots on this Umbrel.</p>
      </div>
    </header>
    <p class="banner">Save your tokens here. The bots stay off until a platform is enabled, then they pick up the new settings without SSH.</p>
    <form id="form" class="grid">
      <section>
        <div class="toggle">
          <input id="DISCORD_ENABLED" name="DISCORD_ENABLED" type="checkbox">
          <h2>Discord</h2>
        </div>
        <p class="hint">Create a bot in the Discord Developer Portal, invite it with Manage Roles, and put the miner role below the bot role.</p>
        <label>Bot token</label>
        <input id="DISCORD_TOKEN" name="DISCORD_TOKEN" type="password" autocomplete="off" placeholder="Paste the Discord bot token">
        <div class="row">
          <div>
            <label>Application ID</label>
            <input id="DISCORD_CLIENT_ID" name="DISCORD_CLIENT_ID" placeholder="Client ID">
          </div>
          <div>
            <label>Server ID</label>
            <input id="DISCORD_GUILD_ID" name="DISCORD_GUILD_ID" placeholder="Guild ID">
          </div>
        </div>
        <label>Verified role ID</label>
        <input id="VERIFIED_ROLE_ID" name="VERIFIED_ROLE_ID" placeholder="Role granted after DATUM checks pass">
        <p class="status" id="discordStatus">Discord is waiting for settings.</p>
        <p id="discordInvite"></p>
      </section>
      <section>
        <div class="toggle">
          <input id="TELEGRAM_ENABLED" name="TELEGRAM_ENABLED" type="checkbox">
          <h2>Telegram</h2>
        </div>
        <p class="hint">Create a bot with BotFather, add it to your community as admin with Invite users and Ban users, then paste the chat id.</p>
        <label>Bot token</label>
        <input id="TELEGRAM_BOT_TOKEN" name="TELEGRAM_BOT_TOKEN" type="password" autocomplete="off" placeholder="Paste the BotFather token">
        <label>Community chat ID</label>
        <input id="TELEGRAM_CHAT_ID" name="TELEGRAM_CHAT_ID" placeholder="-100…  You can save the token first, then send /chatid in the group">
        <label>Mini App URL</label>
        <input id="WEBAPP_URL" name="WEBAPP_URL">
        <p class="status" id="telegramStatus">Telegram is waiting for settings.</p>
      </section>
      <section>
        <h2>Scan</h2>
        <p class="hint">Linked miners are rechecked on this interval. Access is removed only when every pool answers and none still show fresh DATUM shares.</p>
        <div class="row">
          <div>
            <label>Scan interval (hours)</label>
            <input id="SCAN_INTERVAL_HOURS" name="SCAN_INTERVAL_HOURS">
          </div>
          <div>
            <label>Share max age (hours)</label>
            <input id="SHARE_MAX_AGE_HOURS" name="SHARE_MAX_AGE_HOURS">
          </div>
        </div>
        <div class="toggle" style="margin-top:16px">
          <input id="CONVOY_TREAT_ACTIVE_AS_DATUM" name="CONVOY_TREAT_ACTIVE_AS_DATUM" type="checkbox">
          <span>Treat an active CONVOY worker as DATUM</span>
        </div>
      </section>
      <section>
        <h2>First-run checklist</h2>
        <ol>
          <li>Enable Discord, Telegram, or both, then save.</li>
          <li>Invite the Discord bot and keep its role above the verified role.</li>
          <li>Add the Telegram bot to the community, send <code>/chatid</code>, paste that id, and save again.</li>
          <li>Members run <code>/verify</code> in Discord or Telegram. They stay on your Umbrel after that.</li>
        </ol>
        <div class="actions">
          <button type="submit">Save and start bots</button>
          <button type="button" class="secondary" id="refresh">Refresh status</button>
        </div>
        <p class="flash" id="flash">Saved. The selected bots will start or reload now.</p>
      </section>
    </form>
  </main>
  <script>
    const fields = [
      'DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_GUILD_ID','VERIFIED_ROLE_ID',
      'TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','WEBAPP_URL','SCAN_INTERVAL_HOURS','SHARE_MAX_AGE_HOURS'
    ]
    async function load() {
      const response = await fetch('/api/status')
      const data = await response.json()
      document.getElementById('DISCORD_ENABLED').checked = data.settings.DISCORD_ENABLED === '1'
      document.getElementById('TELEGRAM_ENABLED').checked = data.settings.TELEGRAM_ENABLED === '1'
      document.getElementById('CONVOY_TREAT_ACTIVE_AS_DATUM').checked = data.settings.CONVOY_TREAT_ACTIVE_AS_DATUM !== 'false'
      for (const key of fields) {
        const el = document.getElementById(key)
        if (key === 'DISCORD_TOKEN' || key === 'TELEGRAM_BOT_TOKEN') {
          el.value = ''
          el.placeholder = data.settings[key] ? 'Saved — paste a new token to replace it' : el.placeholder
        } else {
          el.value = data.settings[key] || ''
        }
      }
      const discord = document.getElementById('discordStatus')
      discord.textContent = data.discord.detail
      discord.className = 'status ' + (data.discord.ok ? 'ok' : 'bad')
      const telegram = document.getElementById('telegramStatus')
      telegram.textContent = data.telegram.detail
      telegram.className = 'status ' + (data.telegram.ok ? 'ok' : 'bad')
      const invite = document.getElementById('discordInvite')
      invite.innerHTML = data.settings.discordInviteUrl
        ? '<a href="' + data.settings.discordInviteUrl + '" target="_blank" rel="noreferrer">Open Discord invite link</a>'
        : ''
    }
    document.getElementById('form').addEventListener('submit', async (event) => {
      event.preventDefault()
      const body = {
        DISCORD_ENABLED: document.getElementById('DISCORD_ENABLED').checked ? '1' : '0',
        TELEGRAM_ENABLED: document.getElementById('TELEGRAM_ENABLED').checked ? '1' : '0',
        CONVOY_TREAT_ACTIVE_AS_DATUM: document.getElementById('CONVOY_TREAT_ACTIVE_AS_DATUM').checked ? 'true' : 'false',
      }
      for (const key of fields) body[key] = document.getElementById(key).value
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        alert('Could not save settings')
        return
      }
      const flash = document.getElementById('flash')
      flash.style.display = 'block'
      setTimeout(load, 1500)
    })
    document.getElementById('refresh').addEventListener('click', load)
    load()
    setInterval(load, 15000)
  </script>
</body>
</html>
`

ensureDataDir()

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`)
  try {
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(response, 200, PAGE, 'text/html; charset=utf-8')
    }
    if (request.method === 'GET' && url.pathname === '/icon.png') {
      const icon = fs.readFileSync(path.join(import.meta.dirname, 'icon.png'))
      response.writeHead(200, {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=86400',
      })
      return response.end(icon)
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return send(response, 200, { ok: true })
    }
    if (request.method === 'GET' && url.pathname === '/api/status') {
      const settings = readSettings()
      const [discord, telegram] = await Promise.all([
        settings.DISCORD_ENABLED === '1' ? probeDiscord(settings.DISCORD_TOKEN) : Promise.resolve({ ok: false, detail: 'Discord is turned off.' }),
        settings.TELEGRAM_ENABLED === '1' ? probeTelegram(settings.TELEGRAM_BOT_TOKEN) : Promise.resolve({ ok: false, detail: 'Telegram is turned off.' }),
      ])
      return send(response, 200, { settings: publicSettings(settings), discord, telegram })
    }
    if (request.method === 'POST' && url.pathname === '/api/settings') {
      const incoming = await parseBody(request)
      const next = mergeSettings(readSettings(), incoming)
      writeSettings(next)
      return send(response, 200, { ok: true, settings: publicSettings(next) })
    }
    send(response, 404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    send(response, 500, { error: 'Server error' })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DATUMVerified settings listening on ${PORT}`)
})
