import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getMiner, openDatabase, saveMiner } from '../src/db.js'
import { membershipAction } from '../src/policy.js'
import { rescanMiners } from '../src/rescan.js'

function cleanup(file, db) {
  db?.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true })
}

function seed(db) {
  saveMiner(db, {
    telegramId: '5',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    addressType: 'p2wpkh',
    signature: 'sig',
    verifiedAt: 1,
    roleGranted: true,
  })
}

test('membership stays when shares are fresh and is kept when a pool is down', () => {
  assert.equal(membershipAction({ activeDatum: true, conclusive: true }), 'keep')
  assert.equal(membershipAction({ activeDatum: false, conclusive: false }), 'skip')
  assert.equal(membershipAction({ activeDatum: false, conclusive: true }), 'revoke')
})

test('a conclusive scan with no DATUM shares removes access', async () => {
  const file = path.join(os.tmpdir(), `datum-rescan-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  seed(db)
  const revoked = []
  const notified = []
  await rescanMiners({}, db, { shareMaxAgeHours: 24 }, {
    loadSharedSnapshots: async () => ({}),
    scanAddress: async () => ({ activeDatum: false, conclusive: true, results: [] }),
    grantAccess: async () => { throw new Error('should not grant') },
    revokeAccess: async (_api, _config, userId) => { revoked.push(userId) },
    notify: async (userId, address) => { notified.push([userId, address]) },
    sleep: async () => {},
  })
  assert.deepEqual(revoked, ['5'])
  assert.equal(notified[0][0], '5')
  assert.match(notified[0][1], /bc1q/)
  assert.equal(getMiner(db, '5').roleGranted, 0)
  cleanup(file, db)
})

test('a pool that does not answer leaves access in place', async () => {
  const file = path.join(os.tmpdir(), `datum-rescan-skip-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  seed(db)
  let revoked = false
  await rescanMiners({}, db, {}, {
    loadSharedSnapshots: async () => ({}),
    scanAddress: async () => ({ activeDatum: false, conclusive: false, results: [] }),
    revokeAccess: async () => { revoked = true },
    grantAccess: async () => { throw new Error('should not grant') },
    sleep: async () => {},
  })
  assert.equal(revoked, false)
  assert.equal(getMiner(db, '5').roleGranted, 1)
  cleanup(file, db)
})
