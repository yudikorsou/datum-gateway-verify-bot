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
  DISCORD_COMMUNITIES: '[]',
  TELEGRAM_ENABLED: '0',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',
  TELEGRAM_CHAT_IDS: '[]',
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

function parseDiscordCommunities(settings) {
  const list = []
  try {
    const parsed = JSON.parse(settings.DISCORD_COMMUNITIES || '[]')
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const guildId = String(entry?.guildId || '').trim()
        const roleId = String(entry?.roleId || '').trim()
        if (guildId && roleId && !list.some((item) => item.guildId === guildId)) {
          list.push({ guildId, roleId })
        }
      }
    }
  } catch {
    // Fall back to legacy fields below.
  }
  const legacyGuild = String(settings.DISCORD_GUILD_ID || '').trim()
  const legacyRole = String(settings.VERIFIED_ROLE_ID || '').trim()
  if (legacyGuild && legacyRole && !list.some((item) => item.guildId === legacyGuild)) {
    list.unshift({ guildId: legacyGuild, roleId: legacyRole })
  }
  return list.length ? list : [{ guildId: '', roleId: '' }]
}

function parseTelegramChatIds(settings) {
  const ids = []
  try {
    const parsed = JSON.parse(settings.TELEGRAM_CHAT_IDS || '[]')
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        const id = String(value || '').trim()
        if (id && !ids.includes(id)) ids.push(id)
      }
    }
  } catch {
    // Fall back to legacy field below.
  }
  const legacy = String(settings.TELEGRAM_CHAT_ID || '').trim()
  if (legacy && !ids.includes(legacy)) ids.unshift(legacy)
  return ids.length ? ids : ['']
}

function normalizeCommunityFields(next) {
  const guilds = parseDiscordCommunities(next).filter((entry) => entry.guildId && entry.roleId)
  next.DISCORD_COMMUNITIES = JSON.stringify(guilds)
  next.DISCORD_GUILD_ID = guilds[0]?.guildId || ''
  next.VERIFIED_ROLE_ID = guilds[0]?.roleId || ''
  const chats = parseTelegramChatIds(next).filter(Boolean)
  next.TELEGRAM_CHAT_IDS = JSON.stringify(chats)
  next.TELEGRAM_CHAT_ID = chats[0] || ''
  return next
}

function publicSettings(settings) {
  const normalized = normalizeCommunityFields({ ...settings })
  const out = { ...normalized }
  for (const key of SECRET_KEYS) out[key] = maskSecret(settings[key])
  out.discordTokenSet = Boolean(settings.DISCORD_TOKEN)
  out.telegramTokenSet = Boolean(settings.TELEGRAM_BOT_TOKEN)
  out.discordCommunities = parseDiscordCommunities(normalized)
  out.telegramChatIds = parseTelegramChatIds(normalized)
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
    if (Array.isArray(value) || typeof value === 'object') value = JSON.stringify(value)
    value = String(value).trim()
    if (SECRET_KEYS.has(key) && (!value || value.includes('…') || value === '••••')) continue
    if (key.endsWith('_ENABLED')) next[key] = value === '1' || value === 'true' || value === 'on' ? '1' : '0'
    else next[key] = value
  }
  if (Array.isArray(incoming.discordCommunities)) {
    next.DISCORD_COMMUNITIES = JSON.stringify(
      incoming.discordCommunities
        .map((entry) => ({
          guildId: String(entry?.guildId || '').trim(),
          roleId: String(entry?.roleId || '').trim(),
        }))
        .filter((entry) => entry.guildId && entry.roleId),
    )
  }
  if (Array.isArray(incoming.telegramChatIds)) {
    next.TELEGRAM_CHAT_IDS = JSON.stringify(
      incoming.telegramChatIds.map((value) => String(value || '').trim()).filter(Boolean),
    )
  }
  if (!next.WEBAPP_URL) next.WEBAPP_URL = DEFAULT_WEBAPP
  if (!next.SCAN_INTERVAL_HOURS) next.SCAN_INTERVAL_HOURS = '24'
  if (!next.SHARE_MAX_AGE_HOURS) next.SHARE_MAX_AGE_HOURS = '24'
  if (next.CONVOY_TREAT_ACTIVE_AS_DATUM !== 'false') next.CONVOY_TREAT_ACTIVE_AS_DATUM = 'true'
  return normalizeCommunityFields(next)
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
  <title>DATUM Verified</title>
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
    .community-list { display: grid; gap: 12px; margin-top: 8px; }
    .community-row {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 10px;
      align-items: end;
    }
    .community-row.single { grid-template-columns: 1fr auto; }
    .community-row button {
      padding: 11px 14px;
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--line);
      font-weight: 600;
    }
    button.add {
      margin-top: 12px;
      background: transparent;
      color: var(--text);
      border: 1px dashed var(--line);
      font-weight: 600;
    }
    .build {
      margin-top: 18px;
      color: var(--muted);
      font-size: 12px;
    }
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
      <div class="mark"><img src="/icon.png" alt="DATUM Verified"></div>
      <div>
        <h1>DATUM Verified</h1>
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
        <p class="hint">Create one Discord bot, invite it to every server you want to verify, and add each server plus its verified role below. One miner proof unlocks all of them.</p>
        <label>Bot token</label>
        <input id="DISCORD_TOKEN" name="DISCORD_TOKEN" type="password" autocomplete="off" placeholder="Paste the Discord bot token">
        <label>Application ID</label>
        <input id="DISCORD_CLIENT_ID" name="DISCORD_CLIENT_ID" placeholder="Client ID">
        <label>Discord communities</label>
        <div id="discordCommunities" class="community-list"></div>
        <button type="button" class="add" id="addDiscordCommunity">Add another Discord server</button>
        <p class="status" id="discordStatus">Discord is waiting for settings.</p>
        <p id="discordInvite"></p>
      </section>
      <section>
        <div class="toggle">
          <input id="TELEGRAM_ENABLED" name="TELEGRAM_ENABLED" type="checkbox">
          <h2>Telegram</h2>
        </div>
        <p class="hint">Create one Telegram bot, add it as admin to every community, send /chatid in each, and paste those chat ids below. One miner proof unlocks all of them.</p>
        <label>Bot token</label>
        <input id="TELEGRAM_BOT_TOKEN" name="TELEGRAM_BOT_TOKEN" type="password" autocomplete="off" placeholder="Paste the BotFather token">
        <label>Telegram communities</label>
        <div id="telegramCommunities" class="community-list"></div>
        <button type="button" class="add" id="addTelegramCommunity">Add another Telegram community</button>
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
          <li>Invite the same Discord bot into every server and keep its role above each verified role.</li>
          <li>Add the same Telegram bot to each community, send <code>/chatid</code>, and add every id below.</li>
          <li>Members verify once. The bots grant access in all configured communities on this Umbrel.</li>
        </ol>
        <div class="actions">
          <button type="submit">Save and start bots</button>
          <button type="button" class="secondary" id="refresh">Refresh status</button>
        </div>
        <p class="flash" id="flash">Saved. The selected bots will start or reload now.</p>
        <p class="build" id="buildStamp">DATUM Verified settings · keep-form-3</p>
      </section>
    </form>
  </main>
  <script>
    const BUILD = 'keep-form-3'
    const fields = [
      'DISCORD_TOKEN','DISCORD_CLIENT_ID',
      'TELEGRAM_BOT_TOKEN','WEBAPP_URL','SCAN_INTERVAL_HOURS','SHARE_MAX_AGE_HOURS'
    ]
    let formDirty = false
    document.getElementById('form').addEventListener('input', () => { formDirty = true })
    document.getElementById('form').addEventListener('change', () => { formDirty = true })
    function discordRow(entry = { guildId: '', roleId: '' }) {
      const row = document.createElement('div')
      row.className = 'community-row'
      row.innerHTML = \`
        <div>
          <label>Server ID</label>
          <input class="guild-id" placeholder="Guild ID" value="\${entry.guildId || ''}">
        </div>
        <div>
          <label>Verified role ID</label>
          <input class="role-id" placeholder="Role ID" value="\${entry.roleId || ''}">
        </div>
        <button type="button" class="remove">Remove</button>
      \`
      row.querySelector('.remove').addEventListener('click', () => {
        formDirty = true
        const list = document.getElementById('discordCommunities')
        if (list.children.length <= 1) {
          row.querySelector('.guild-id').value = ''
          row.querySelector('.role-id').value = ''
          return
        }
        row.remove()
      })
      return row
    }
    function telegramRow(value = '') {
      const row = document.createElement('div')
      row.className = 'community-row single'
      row.innerHTML = \`
        <div>
          <label>Community chat ID</label>
          <input class="chat-id" placeholder="-100…" value="\${value || ''}">
        </div>
        <button type="button" class="remove">Remove</button>
      \`
      row.querySelector('.remove').addEventListener('click', () => {
        formDirty = true
        const list = document.getElementById('telegramCommunities')
        if (list.children.length <= 1) {
          row.querySelector('.chat-id').value = ''
          return
        }
        row.remove()
      })
      return row
    }
    function renderCommunities(settings) {
      const discord = document.getElementById('discordCommunities')
      const telegram = document.getElementById('telegramCommunities')
      discord.innerHTML = ''
      telegram.innerHTML = ''
      for (const entry of settings.discordCommunities || [{ guildId: '', roleId: '' }]) {
        discord.appendChild(discordRow(entry))
      }
      for (const chatId of settings.telegramChatIds || ['']) {
        telegram.appendChild(telegramRow(chatId))
      }
    }
    function collectDiscordCommunities() {
      return [...document.querySelectorAll('#discordCommunities .community-row')].map((row) => ({
        guildId: row.querySelector('.guild-id').value.trim(),
        roleId: row.querySelector('.role-id').value.trim(),
      }))
    }
    function collectTelegramChatIds() {
      return [...document.querySelectorAll('#telegramCommunities .chat-id')].map((input) => input.value.trim())
    }
    function applyForm(settings) {
      document.getElementById('DISCORD_ENABLED').checked = settings.DISCORD_ENABLED === '1'
      document.getElementById('TELEGRAM_ENABLED').checked = settings.TELEGRAM_ENABLED === '1'
      document.getElementById('CONVOY_TREAT_ACTIVE_AS_DATUM').checked = settings.CONVOY_TREAT_ACTIVE_AS_DATUM !== 'false'
      for (const key of fields) {
        const el = document.getElementById(key)
        if (key === 'DISCORD_TOKEN' || key === 'TELEGRAM_BOT_TOKEN') {
          el.value = ''
          const empty = el.getAttribute('data-empty-placeholder') || el.placeholder
          if (!el.getAttribute('data-empty-placeholder')) el.setAttribute('data-empty-placeholder', empty)
          el.placeholder = settings[key] ? 'Saved — paste a new token to replace it' : empty
        } else {
          el.value = settings[key] || ''
        }
      }
      renderCommunities(settings)
      formDirty = false
    }
    function applyStatus(data) {
      const discord = document.getElementById('discordStatus')
      const guildCount = (data.settings.discordCommunities || []).filter((entry) => entry.guildId && entry.roleId).length
      discord.textContent = data.discord.detail + (guildCount ? \` · \${guildCount} server\${guildCount === 1 ? '' : 's'}\` : '')
      discord.className = 'status ' + (data.discord.ok ? 'ok' : 'bad')
      const telegram = document.getElementById('telegramStatus')
      const chatCount = (data.settings.telegramChatIds || []).filter(Boolean).length
      telegram.textContent = data.telegram.detail + (chatCount ? \` · \${chatCount} Telegram chat\${chatCount === 1 ? '' : 's'}\` : '')
      telegram.className = 'status ' + (data.telegram.ok ? 'ok' : 'bad')
      const invite = document.getElementById('discordInvite')
      invite.innerHTML = data.settings.discordInviteUrl
        ? '<a href="' + data.settings.discordInviteUrl + '" target="_blank" rel="noreferrer">Open Discord invite link</a>'
        : ''
      document.getElementById('buildStamp').textContent = 'DATUM Verified settings · ' + BUILD
    }
    async function refreshStatus() {
      const response = await fetch('/api/status', { cache: 'no-store' })
      const data = await response.json()
      applyStatus(data)
      return data
    }
    async function loadForm() {
      const data = await refreshStatus()
      applyForm(data.settings)
      return data
    }
    document.getElementById('addDiscordCommunity').addEventListener('click', () => {
      formDirty = true
      document.getElementById('discordCommunities').appendChild(discordRow())
    })
    document.getElementById('addTelegramCommunity').addEventListener('click', () => {
      formDirty = true
      document.getElementById('telegramCommunities').appendChild(telegramRow())
    })
    document.getElementById('form').addEventListener('submit', async (event) => {
      event.preventDefault()
      const body = {
        DISCORD_ENABLED: document.getElementById('DISCORD_ENABLED').checked ? '1' : '0',
        TELEGRAM_ENABLED: document.getElementById('TELEGRAM_ENABLED').checked ? '1' : '0',
        CONVOY_TREAT_ACTIVE_AS_DATUM: document.getElementById('CONVOY_TREAT_ACTIVE_AS_DATUM').checked ? 'true' : 'false',
        discordCommunities: collectDiscordCommunities(),
        telegramChatIds: collectTelegramChatIds(),
      }
      for (const key of fields) body[key] = document.getElementById(key).value
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      if (!response.ok) {
        alert('Could not save settings')
        return
      }
      const flash = document.getElementById('flash')
      flash.style.display = 'block'
      formDirty = false
      setTimeout(() => { loadForm().catch(console.error) }, 800)
    })
    document.getElementById('refresh').addEventListener('click', () => {
      refreshStatus().catch(console.error)
    })
    loadForm().catch(console.error)
    setInterval(() => { refreshStatus().catch(() => {}) }, 20000)
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
  console.log(`DATUM Verified settings listening on ${PORT}`)
})
