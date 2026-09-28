import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createChallenge } from '../src/challenge.js'
import { getMiner, openDatabase, saveMiner } from '../src/db.js'

test('a linked miner can be stored and read back', () => {
  const file = path.join(os.tmpdir(), `datum-bot-${Date.now()}.sqlite`)
  const db = openDatabase(file)
  const challenge = createChallenge({ discordId: '99', address: 'bc1qexample', now: 1_700_000_000_000 })
  assert.match(challenge.message, /Discord user: 99/)
  assert.match(challenge.message, /bc1qexample/)
  saveMiner(db, {
    discordId: '99',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    addressType: 'p2wpkh',
    signature: 'abc',
    verifiedAt: 10,
    roleGranted: true,
    lastScanAt: 11,
    lastScanJson: '{"activeDatum":true}',
  })
  const row = getMiner(db, '99')
  assert.equal(row.roleGranted, 1)
  assert.equal(row.addressType, 'p2wpkh')
  fs.rmSync(file, { force: true })
})
