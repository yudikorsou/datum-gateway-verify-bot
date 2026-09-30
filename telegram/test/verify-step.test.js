import assert from 'node:assert/strict'
import test from 'node:test'
import { restoreDecision } from '../src/verify-step.js'

test('restore grants only while a pool still shows DATUM shares', () => {
  assert.equal(restoreDecision({ activeDatum: true, conclusive: true }), 'grant')
  assert.equal(restoreDecision({ activeDatum: true, conclusive: false }), 'grant')
  assert.equal(restoreDecision({ activeDatum: false, conclusive: true }), 'deny')
  assert.equal(restoreDecision({ activeDatum: false, conclusive: false }), 'retry')
})
