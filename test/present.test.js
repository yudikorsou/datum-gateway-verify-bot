import test from 'node:test'
import assert from 'node:assert/strict'
import { optionsRow, signatureRow, startRow } from '../src/present.js'

test('options row includes restore, sign again, and add another wallet', () => {
  const ids = optionsRow().components.map((button) => button.data.custom_id)
  const labels = optionsRow().components.map((button) => button.data.label)
  assert.deepEqual(ids, ['verify:restore', 'verify:sign-again', 'verify:open-address'])
  assert.deepEqual(labels, ['Restore role', 'Sign again', 'Add another wallet'])
})

test('start and signature rows keep their original actions', () => {
  assert.equal(startRow().components[0].data.custom_id, 'verify:open-address')
  assert.equal(signatureRow().components[0].data.custom_id, 'verify:open-signature')
})
