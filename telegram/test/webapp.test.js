import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addressFormMarkup,
  addressFormUrl,
  parseWebAppData,
  signatureFormMarkup,
  signatureFormUrl,
} from '../src/webapp.js'

test('form URLs open the matching paste field', () => {
  assert.equal(
    addressFormUrl('https://yudikorsou.github.io/datum-gateway-telegram-verify-bot'),
    'https://yudikorsou.github.io/datum-gateway-telegram-verify-bot/?v=bip322',
  )
  const signed = signatureFormUrl('https://example.test/form', '4242')
  assert.equal(signed, 'https://example.test/form/?v=bip322&uid=4242')
})

test('buttons attach Telegram web app fields', () => {
  const config = { webAppUrl: 'https://example.test/form/' }
  const address = addressFormMarkup(config)
  assert.equal(address.inline_keyboard[0][0].text, 'Open DATUM verification')
  assert.match(address.inline_keyboard[0][0].web_app.url, /v=bip322/)
  const signature = signatureFormMarkup(config, '99')
  assert.equal(signature.inline_keyboard[0][0].text, 'Open DATUM verification')
  assert.match(signature.inline_keyboard[0][0].web_app.url, /v=bip322/)
  assert.match(signature.inline_keyboard[0][0].web_app.url, /uid=99/)
})

test('web app payloads only accept filled fields', () => {
  assert.deepEqual(
    parseWebAppData(JSON.stringify({ type: 'address', address: ' bc1qabc ' })),
    { type: 'address', address: 'bc1qabc' },
  )
  assert.deepEqual(
    parseWebAppData(JSON.stringify({ type: 'signature', signature: ' SIG== ' })),
    { type: 'signature', signature: 'SIG==' },
  )
  assert.deepEqual(
    parseWebAppData(JSON.stringify({
      type: 'proof',
      address: ' bc1qabc ',
      signature: ' SIG== ',
      nonce: 'aa'.repeat(16),
      issued: '2026-09-30T01:00:00.000Z',
    })),
    {
      type: 'proof',
      address: 'bc1qabc',
      signature: 'SIG==',
      nonce: 'aa'.repeat(16),
      issued: '2026-09-30T01:00:00.000Z',
    },
  )
  assert.equal(parseWebAppData(JSON.stringify({ type: 'address', address: '' })), null)
  assert.equal(parseWebAppData('not-json'), null)
})
