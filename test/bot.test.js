import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldSkipChannelOverwrite } from '../src/bot.js'

test('locked community channels keep their permission overwrites', () => {
  assert.equal(shouldSkipChannelOverwrite({ type: 0, name: 'gateway' }), true)
  assert.equal(shouldSkipChannelOverwrite({ type: 5, name: 'Gateway' }), true)
  assert.equal(shouldSkipChannelOverwrite({ type: 0, name: 'mods' }), true)
  assert.equal(shouldSkipChannelOverwrite({ type: 0, name: 'general' }), false)
  assert.equal(shouldSkipChannelOverwrite({ type: 15, name: 'forum' }), true)
})
