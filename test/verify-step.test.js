import test from 'node:test'
import assert from 'node:assert/strict'
import { linkedAddress, verifyEntry } from '../src/verify-step.js'

test('a linked miner opens the restore menu instead of a new signature', () => {
  assert.equal(verifyEntry({
    miner: { address: 'bc1qabc' },
    challenge: null,
    hasRole: false,
  }), 'menu')
  assert.equal(verifyEntry({
    miner: { address: 'bc1qabc' },
    hasRole: true,
    suppliedAddress: 'bc1qabc',
  }), 'menu')
})

test('a member who already has the role can restore without signing again', () => {
  assert.equal(verifyEntry({
    miner: null,
    challenge: { address: 'bc1qabc', expiresAt: Date.now() + 1000 },
    hasRole: true,
  }), 'menu')
  assert.equal(verifyEntry({
    miner: null,
    hasRole: true,
    suppliedAddress: 'bc1qabc',
  }), 'menu')
})

test('a new wallet or a first-time user still gets a signature challenge', () => {
  assert.equal(verifyEntry({
    miner: { address: 'bc1qold' },
    hasRole: true,
    suppliedAddress: 'bc1qnew',
  }), 'challenge')
  assert.equal(verifyEntry({
    miner: null,
    challenge: null,
    hasRole: false,
  }), 'ask-address')
  assert.equal(verifyEntry({
    miner: null,
    challenge: { address: 'bc1qabc', expiresAt: Date.now() + 1000 },
    hasRole: false,
  }), 'resume-challenge')
})

test('linkedAddress prefers the saved miner over a pending challenge', () => {
  assert.equal(linkedAddress({ address: 'bc1qminer' }, { address: 'bc1qchallenge' }), 'bc1qminer')
  assert.equal(linkedAddress(null, { address: 'bc1qchallenge' }), 'bc1qchallenge')
})
