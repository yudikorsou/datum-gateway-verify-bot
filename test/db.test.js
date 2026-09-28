import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createChallenge } from '../src/challenge.js'
import { getChallenge, getMiner, openDatabase, saveMiner } from '../src/db.js'

function cleanup(file, db) {
  db?.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true })
}

test('a linked miner can be stored and read back', () => {
  const file = path.join(os.tmpdir(), `datum-bot-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const challenge = createChallenge({ telegramId: '99', address: 'bc1qexample', now: 1_700_000_000_000 })
  assert.match(challenge.message, /Telegram user: 99/)
  assert.match(challenge.message, /bc1qexample/)
  saveMiner(db, {
    telegramId: '99',
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
  cleanup(file, db)
})

test('an older discord database is readable as telegram ids', () => {
  const file = path.join(os.tmpdir(), `datum-bot-old-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const created = new DatabaseSync(file)
  created.exec(`
    CREATE TABLE challenges (
      discord_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      message TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    INSERT INTO challenges (discord_id, address, message, nonce, expires_at)
    VALUES ('7', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'msg', 'nonce', 5);
  `)
  created.close()
  const db = openDatabase(file)
  const row = getChallenge(db, '7')
  assert.equal(row.telegramId, '7')
  assert.equal(row.phase, 'signature')
  assert.equal(row.signature, null)
  cleanup(file, db)
})
