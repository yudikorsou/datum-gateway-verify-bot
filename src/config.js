import fs from 'node:fs'
import path from 'node:path'

export function loadEnvFile(file = '.env') {
  const full = path.resolve(file)
  if (!fs.existsSync(full)) return
  const text = fs.readFileSync(full, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`)
  return value
}

function numberEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`)
  }
  return value
}

function boolEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new Error(`${name} must be true or false`)
}

function parseJsonList(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null
  const text = String(raw).trim()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('DISCORD_COMMUNITIES must be a JSON array of { guildId, roleId } objects.')
  }
}

export function normalizeGuilds(env = process.env) {
  const fromJson = parseJsonList(env.DISCORD_COMMUNITIES)
  const guilds = []
  if (Array.isArray(fromJson)) {
    for (const entry of fromJson) {
      const guildId = String(entry?.guildId || entry?.guild_id || '').trim()
      const roleId = String(entry?.roleId || entry?.role_id || '').trim()
      if (!guildId || !roleId) continue
      if (guilds.some((item) => item.guildId === guildId)) continue
      guilds.push({ guildId, roleId })
    }
  }
  const legacyGuild = String(env.DISCORD_GUILD_ID || '').trim()
  const legacyRole = String(env.VERIFIED_ROLE_ID || '').trim()
  if (legacyGuild && legacyRole && !guilds.some((item) => item.guildId === legacyGuild)) {
    guilds.unshift({ guildId: legacyGuild, roleId: legacyRole })
  }
  return guilds
}

export function readConfig() {
  loadEnvFile()
  const guilds = normalizeGuilds()
  if (!guilds.length) {
    throw new Error(
      'Missing Discord communities. Set DISCORD_GUILD_ID and VERIFIED_ROLE_ID, or DISCORD_COMMUNITIES as a JSON array.',
    )
  }
  return {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guilds,
    guildId: guilds[0].guildId,
    roleId: guilds[0].roleId,
    scanIntervalHours: numberEnv('SCAN_INTERVAL_HOURS', 24),
    shareMaxAgeHours: numberEnv('SHARE_MAX_AGE_HOURS', 24),
    convoyTreatActiveAsDatum: boolEnv('CONVOY_TREAT_ACTIVE_AS_DATUM', true),
    databasePath: process.env.DATABASE_PATH || './data/bot.sqlite',
    challengeMinutes: 30,
  }
}

export function guildEntry(config, guildId) {
  if (!guildId) return null
  return config.guilds.find((entry) => entry.guildId === String(guildId)) || null
}

export function configuredGuildIds(config) {
  return config.guilds.map((entry) => entry.guildId)
}
