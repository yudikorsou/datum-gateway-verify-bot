import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { payments, networks, initEccLib } from 'bitcoinjs-lib'
import { ECPairFactory } from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import bitcoinMessage from 'bitcoinjs-message'
import { getMiner, openDatabase } from '../src/db.js'
import { onDatumCheck, onPrivateTextMessage, onStart } from '../src/flow.js'

initEccLib(ecc)
const ECPair = ECPairFactory(ecc)

function cleanup(file, db) {
  db?.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true })
}

function fakeCtx(userId, text) {
  const sent = []
  return {
    sent,
    from: { id: Number(userId) },
    chat: { type: 'private', id: Number(userId) },
    message: { text },
    reply: async (body, extra) => { sent.push({ text: body, extra }) },
    answerCallbackQuery: async (payload) => { sent.push({ callback: payload }) },
  }
}

function wallet() {
  const key = ECPair.makeRandom()
  const privateKey = Buffer.from(key.privateKey)
  const pubkey = Buffer.from(key.publicKey)
  const address = payments.p2wpkh({ pubkey, network: networks.bitcoin }).address
  return { key, privateKey, pubkey, address }
}

test('ownership is confirmed before the DATUM check, then access is granted', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const config = { challengeMinutes: 30, chatId: '-100', shareMaxAgeHours: 24, convoyTreatActiveAsDatum: true }
  const { privateKey, key, address } = wallet()
  const user = fakeCtx(4242)
  await onStart(user, { db, config })

  const addressCtx = fakeCtx(4242, address)
  await onPrivateTextMessage(addressCtx, { db, config })
  const challenge = addressCtx.sent.at(-1).text
  assert.match(challenge, /Step 1 of 2/)
  assert.match(challenge, /Shrike/)
  const message = challenge.match(/<pre>([\s\S]*?)<\/pre>/)[1]

  const signature = bitcoinMessage.sign(message, privateKey, key.compressed, { segwitType: 'p2wpkh' }).toString('base64')
  const signCtx = fakeCtx(4242, signature)
  await onPrivateTextMessage(signCtx, { db, config })
  assert.match(signCtx.sent.at(-1).text, /Step 2 of 2/)
  assert.equal(signCtx.sent.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data, 'verify:datum')
  assert.equal(getMiner(db, '4242'), undefined)

  let scanned = null
  const datumCtx = fakeCtx(4242)
  await onDatumCheck(datumCtx, {
    db,
    config,
    api: {},
    scanAddress: async (target) => {
      scanned = target
      return {
        activeDatum: true,
        conclusive: true,
        results: [{ id: 'riptide', name: 'RIPTide', ok: true, activeDatum: true, detail: '1 DATUM worker with live hashrate.' }],
      }
    },
    grantAccess: async () => ({ granted: true, inviteLink: 'https://t.me/+once', note: 'This invite works once.' }),
  })
  assert.equal(scanned, address)
  const miner = getMiner(db, '4242')
  assert.equal(miner.address, address)
  assert.equal(miner.roleGranted, 1)
  assert.match(datumCtx.sent.at(-1).text, /community access granted/)
  assert.match(datumCtx.sent.at(-1).text, /https:\/\/t\.me\/\+once/)
  cleanup(file, db)
})

test('a signature match with no DATUM shares does not open the community', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-miss-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const config = { challengeMinutes: 30, chatId: '-100' }
  const { privateKey, key, address } = wallet()
  await onStart(fakeCtx(7), { db, config })
  const addressCtx = fakeCtx(7, address)
  await onPrivateTextMessage(addressCtx, { db, config })
  const message = addressCtx.sent.at(-1).text.match(/<pre>([\s\S]*?)<\/pre>/)[1]
  const signature = bitcoinMessage.sign(message, privateKey, key.compressed, { segwitType: 'p2wpkh' }).toString('base64')
  await onPrivateTextMessage(fakeCtx(7, signature), { db, config })

  let granted = false
  const datumCtx = fakeCtx(7)
  await onDatumCheck(datumCtx, {
    db,
    config,
    scanAddress: async () => ({
      activeDatum: false,
      conclusive: true,
      results: [{ id: 'omega', name: 'OmegaPool', ok: true, activeDatum: false, detail: 'Address is not in the current payout window.' }],
    }),
    grantAccess: async () => { granted = true },
  })
  assert.equal(granted, false)
  assert.equal(getMiner(db, '7'), undefined)
  assert.match(datumCtx.sent.at(-1).text, /no DATUM shares yet/)
  cleanup(file, db)
})

test('worker suffixes and addresses owned by someone else are rejected', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-reject-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const config = { challengeMinutes: 30 }
  const { address } = wallet()
  saveMiner(db, {
    telegramId: '1',
    address,
    addressType: 'p2wpkh',
    signature: 'sig',
    verifiedAt: 1,
    roleGranted: true,
  })
  await onStart(fakeCtx(2), { db, config })
  const taken = fakeCtx(2, address)
  await onPrivateTextMessage(taken, { db, config })
  assert.match(taken.sent.at(-1).text, /another Telegram user/)

  const worker = fakeCtx(2, `${address}.rig1`)
  await onPrivateTextMessage(worker, { db, config })
  assert.match(worker.sent.at(-1).text, /worker suffix/)
  cleanup(file, db)
})

function saveMiner(db, row) {
  db.prepare(`
    INSERT INTO miners (telegram_id, address, address_type, signature, verified_at, role_granted)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(row.telegramId, row.address, row.addressType, row.signature, row.verifiedAt, row.roleGranted ? 1 : 0)
}
