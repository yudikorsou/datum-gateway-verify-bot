import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('the Mini App embeds the Sparrow and Shrike signing video', () => {
  const html = fs.readFileSync(new URL('../webapp/index.html', import.meta.url), 'utf8')
  assert.match(html, /<video/)
  assert.match(html, /sign-the-message\.mp4/)
  assert.match(html, /openedFromKeyboard/)
  assert.match(html, /Checking ownership and DATUM Gateway shares in the background/)
  assert.ok(fs.existsSync(new URL('../webapp/sign-the-message.mp4', import.meta.url)))
})
