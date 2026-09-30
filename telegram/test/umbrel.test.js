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

test('telegram stays idle until it is enabled with a token', () => {
  assert.equal(settingsReady({ TELEGRAM_ENABLED: '1' }, 'telegram'), false)
  assert.equal(settingsReady({ TELEGRAM_ENABLED: '0', TELEGRAM_BOT_TOKEN: 'x:y' }, 'telegram'), false)
  assert.equal(settingsReady({ TELEGRAM_ENABLED: '1', TELEGRAM_BOT_TOKEN: 'x:y' }, 'telegram'), true)
})

test('applyUmbrelSettings is a no-op without SETTINGS_FILE', async () => {
  await applyUmbrelSettings({ platform: 'telegram', settingsFile: undefined })
})

test('applyUmbrelSettings loads JSON into the environment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'datum-verified-tg-'))
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      TELEGRAM_ENABLED: '1',
      TELEGRAM_BOT_TOKEN: '123:abc',
      TELEGRAM_CHAT_ID: '-1001',
    }),
  )
  const env = {}
  applySettingsObject(readSettingsFile(file), env)
  assert.equal(env.TELEGRAM_BOT_TOKEN, '123:abc')
  const previous = process.env.TELEGRAM_BOT_TOKEN
  try {
    delete process.env.TELEGRAM_BOT_TOKEN
    await applyUmbrelSettings({
      platform: 'telegram',
      settingsFile: file,
      watch: false,
      pollMs: 10,
    })
    assert.equal(process.env.TELEGRAM_BOT_TOKEN, '123:abc')
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
