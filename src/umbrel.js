import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

export function settingsReady(env, platform) {
  if (platform === 'discord') {
    return (
      env.DISCORD_ENABLED === '1' &&
      Boolean(env.DISCORD_TOKEN) &&
      Boolean(env.DISCORD_CLIENT_ID) &&
      Boolean(env.DISCORD_GUILD_ID) &&
      Boolean(env.VERIFIED_ROLE_ID)
    )
  }
  if (platform === 'telegram') {
    return env.TELEGRAM_ENABLED === '1' && Boolean(env.TELEGRAM_BOT_TOKEN)
  }
  return false
}

export function applySettingsObject(settings, env = process.env) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return env
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined || value === null) continue
    env[key] = String(value)
  }
  return env
}

export function readSettingsFile(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('settings file must be a JSON object')
  }
  return parsed
}

export async function applyUmbrelSettings({
  platform,
  settingsFile = process.env.SETTINGS_FILE,
  watch = true,
  pollMs = 2000,
  exit = () => process.exit(0),
} = {}) {
  if (!settingsFile) return
  console.log(`DATUMVerified: waiting for ${platform} settings`)
  while (true) {
    try {
      if (fs.existsSync(settingsFile)) {
        applySettingsObject(readSettingsFile(settingsFile))
        if (settingsReady(process.env, platform)) break
      }
    } catch (error) {
      console.error('DATUMVerified: could not read settings', error.message)
    }
    await sleep(pollMs)
  }
  console.log(`DATUMVerified: ${platform} settings loaded`)
  if (!watch) return

  let exiting = false
  const restart = () => {
    if (exiting) return
    exiting = true
    console.log('DATUMVerified: settings changed, restarting')
    exit()
  }

  try {
    fs.watch(settingsFile, { persistent: false }, restart)
  } catch (error) {
    console.error('DATUMVerified: could not watch settings', error.message)
  }

  let last = fs.statSync(settingsFile).mtimeMs
  const timer = setInterval(() => {
    try {
      const now = fs.statSync(settingsFile).mtimeMs
      if (now !== last) restart()
    } catch {
      // Atomic replace can briefly hide the file.
    }
  }, Math.max(pollMs, 2000))
  if (typeof timer.unref === 'function') timer.unref()
}
