import test from 'node:test'
import assert from 'node:assert/strict'
import {
  challengeContent,
  challengeEmbed,
  copySignTextModal,
  copyableSignTextDm,
  optionsRow,
  signatureRow,
  startRow,
} from '../src/present.js'

test('options row includes restore, sign again, and add another wallet', () => {
  const ids = optionsRow().components.map((button) => button.data.custom_id)
  const labels = optionsRow().components.map((button) => button.data.label)
  assert.deepEqual(ids, ['verify:restore', 'verify:sign-again', 'verify:open-address'])
  assert.deepEqual(labels, ['Restore role', 'Sign again', 'Add another wallet'])
})

test('start and signature rows keep their original actions', () => {
  assert.equal(startRow().components[0].data.custom_id, 'verify:open-address')
  assert.deepEqual(signatureRow().components.map((button) => button.data.custom_id), [
    'verify:copy-sign-text',
    'verify:open-signature',
  ])
})

test('challenge content puts the sign text in a copyable code block', () => {
  const message = 'DATUM Gateway Discord verification\nDiscord user: 42\nNonce: abc'
  const content = challengeContent(message, 'Sign this new message in Shrike.')
  assert.match(content, /Sign this new message in Shrike/)
  assert.match(content, /Copy sign text/)
  assert.match(content, /```\nDATUM Gateway Discord verification\nDiscord user: 42\nNonce: abc\n```/)
})

test('challenge embed leaves the sign text out so people copy the popup or DM instead', () => {
  const embed = challengeEmbed({ canonical: 'bc1qexample', label: 'native SegWit' })
  assert.match(embed.data.description, /Copy sign text/)
  assert.doesNotMatch(embed.data.description, /Nonce:/)
  assert.doesNotMatch(embed.data.description, /```/)
})

test('copy popup and DM carry the exact Shrike message', () => {
  const message = 'DATUM Gateway Discord verification\nDiscord user: 42\nNonce: abc'
  const modal = copySignTextModal(message)
  assert.equal(modal.data.custom_id, 'verify:copy-sign-text-modal')
  assert.equal(modal.components[0].components[0].data.value, message)
  assert.match(copyableSignTextDm(message), /Copy Text/)
  assert.match(copyableSignTextDm(message), /```\nDATUM Gateway Discord verification\nDiscord user: 42\nNonce: abc\n```/)
})
