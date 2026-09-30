import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applySettingsObject,
  applyUmbrelSettings,
  readSettingsFile,
  settingsReady,
} from '../src/umbrel.js'

test('discord stays idle until every required field is set', () => {
  assert.equal(settingsReady({ DISCORD_ENABLED: '1', DISCORD_TOKEN: 't' }, 'discord'), false)
  assert.equal(
    settingsReady(
      {
        DISCORD_ENABLED: '1',
        DISCORD_TOKEN: 't',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_GUILD_ID: 'g',
        VERIFIED_ROLE_ID: 'r',
      },
      'discord',
    ),
    true,
  )
  assert.equal(
    settingsReady(
      {
        DISCORD_ENABLED: '0',
        DISCORD_TOKEN: 't',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_GUILD_ID: 'g',
        VERIFIED_ROLE_ID: 'r',
      },
      'discord',
    ),
    false,
  )
})

test('telegram can start with only a bot token', () => {
  assert.equal(settingsReady({ TELEGRAM_ENABLED: '1' }, 'telegram'), false)
  assert.equal(settingsReady({ TELEGRAM_ENABLED: '1', TELEGRAM_BOT_TOKEN: 'x:y' }, 'telegram'), true)
})

test('applyUmbrelSettings is a no-op without SETTINGS_FILE', async () => {
  await applyUmbrelSettings({ platform: 'discord', settingsFile: undefined })
})

test('applyUmbrelSettings loads JSON into the environment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'datum-verified-'))
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      DISCORD_ENABLED: '1',
      DISCORD_TOKEN: 'token-value',
      DISCORD_CLIENT_ID: 'client',
      DISCORD_GUILD_ID: 'guild',
      VERIFIED_ROLE_ID: 'role',
    }),
  )
  const env = {}
  applySettingsObject(readSettingsFile(file), env)
  assert.equal(env.DISCORD_TOKEN, 'token-value')
  const previous = process.env.DISCORD_TOKEN
  try {
    delete process.env.DISCORD_TOKEN
    await applyUmbrelSettings({
      platform: 'discord',
      settingsFile: file,
      watch: false,
      pollMs: 10,
    })
    assert.equal(process.env.DISCORD_TOKEN, 'token-value')
  } finally {
    if (previous === undefined) delete process.env.DISCORD_TOKEN
    else process.env.DISCORD_TOKEN = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
