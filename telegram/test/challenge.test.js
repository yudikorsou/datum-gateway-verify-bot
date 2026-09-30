import assert from 'node:assert/strict'
import test from 'node:test'
import { challengeMessage, createChallenge } from '../src/challenge.js'

test('a client-built sign text matches the bot challenge', () => {
  const issued = '2026-09-30T01:00:00.000Z'
  const nonce = 'ab'.repeat(16)
  const fields = {
    telegramId: '66',
    address: 'bc1qtestaddress',
    nonce,
    issued,
  }
  const created = createChallenge({ ...fields, now: Date.parse(issued) })
  assert.equal(created.nonce, nonce)
  assert.equal(created.message, challengeMessage(fields))
})
