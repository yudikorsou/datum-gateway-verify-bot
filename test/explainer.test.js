import test from 'node:test'
import assert from 'node:assert/strict'
import { explainerFiles, explainerVideoPath } from '../src/explainer.js'

test('the signature explainer video is packaged with the bot', () => {
  const file = explainerVideoPath()
  assert.ok(file)
  assert.match(file, /prove-your-address\.mp4$/)
  const files = explainerFiles()
  assert.equal(files.length, 1)
  assert.equal(files[0].name, 'prove-your-address.mp4')
})
