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

export function readConfig() {
  loadEnvFile()
  return {
    token: required('TELEGRAM_BOT_TOKEN'),
    chatId: required('TELEGRAM_CHAT_ID'),
    scanIntervalHours: numberEnv('SCAN_INTERVAL_HOURS', 24),
    shareMaxAgeHours: numberEnv('SHARE_MAX_AGE_HOURS', 24),
    convoyTreatActiveAsDatum: boolEnv('CONVOY_TREAT_ACTIVE_AS_DATUM', true),
    databasePath: process.env.DATABASE_PATH || './data/bot.sqlite',
    challengeMinutes: 30,
  }
}
