import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { payments, networks, initEccLib } from 'bitcoinjs-lib'
import { ECPairFactory } from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import bitcoinMessage from 'bitcoinjs-message'
import { Signer } from 'bip322-js'
import { getMiner, openDatabase } from '../src/db.js'
import { challengeMessage } from '../src/challenge.js'
import { onRestore, onStart, onTextMessage, onWebAppData } from '../src/flow.js'
import { parseTemplateFields, communityTopicUrl } from '../src/present.js'

initEccLib(ecc)
const ECPair = ECPairFactory(ecc)

function cleanup(file, db) {
  db?.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true })
}

function fakeCtx(userId, text, { privateChat = true } = {}) {
  const sent = []
  return {
    sent,
    from: { id: Number(userId) },
    chat: privateChat ? { type: 'private', id: Number(userId) } : { type: 'supergroup', id: -100 },
    message: { text },
    reply: async (body, extra) => { sent.push({ text: body, extra }) },
    answerCallbackQuery: async (payload) => { sent.push({ callback: payload }) },
  }
}

function apiStub(sent) {
  return {
    getChatMember: async () => ({ status: 'restricted' }),
    restrictChatMember: async () => {},
    sendMessage: async (_id, body, extra) => {
      sent?.push({ text: body, extra })
      return { message_id: 99 }
    },
  }
}

function datumHit() {
  return {
    activeDatum: true,
    conclusive: true,
    results: [{ id: 'riptide', name: 'RIPTide', ok: true, activeDatum: true, detail: '1 DATUM worker with live hashrate.' }],
  }
}

function datumMiss() {
  return {
    activeDatum: false,
    conclusive: true,
    results: [{ id: 'omega', name: 'OmegaPool', ok: true, activeDatum: false, detail: 'Address is not in the current payout window.' }],
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
  const config = {
    challengeMinutes: 30,
    chatId: '-100123456',
    shareMaxAgeHours: 24,
    convoyTreatActiveAsDatum: true,
    webAppUrl: 'https://yudikorsou.github.io/datum-gateway-telegram-verify-bot/',
  }
  const { privateKey, key, address } = wallet()
  const user = fakeCtx(4242)
  await onStart(user, { db, config, api: apiStub() })
  const startForm = user.sent.find((row) => row.text?.includes('DATUM Gateway verification'))
  assert.equal(startForm.extra.reply_markup.inline_keyboard[0][0].text, 'Open DATUM verification')
  assert.match(startForm.extra.reply_markup.inline_keyboard[0][0].web_app.url, /v=bip322/)
  assert.match(startForm.extra.reply_markup.inline_keyboard[0][0].web_app.url, /uid=4242/)

  const addressCtx = fakeCtx(4242, address)
  await onTextMessage(addressCtx, { db, config, api: apiStub() })
  const challenge = addressCtx.sent.find((row) => row.text?.includes('Access request — template 2 of 2')).text
  assert.match(challenge, /Open DATUM verification/)
  const signForm = addressCtx.sent.find((row) => row.text?.includes('Access request — template 2 of 2'))
  assert.equal(signForm.extra.reply_markup.inline_keyboard[0][0].text, 'Open DATUM verification')
  const message = challenge.match(/Sign this exact text[\s\S]*?<pre>([\s\S]*?)<\/pre>/)[1]

  const signature = bitcoinMessage.sign(message, privateKey, key.compressed, { segwitType: 'p2wpkh' }).toString('base64')
  const signCtx = fakeCtx(4242, signature)
  const api = apiStub(signCtx.sent)
  let scanned = null
  await onTextMessage(signCtx, {
    db,
    config,
    api,
    scanAddress: async (target) => {
      scanned = target
      return datumHit()
    },
    grantAccess: async () => ({ granted: true, inviteLink: null, note: 'You can send messages in the community now.' }),
  })
  assert.match(signCtx.sent.find((row) => row.text?.includes('Address proved')).text, /Address proved/)
  assert.equal(scanned, address)
  const miner = getMiner(db, '4242')
  assert.equal(miner.address, address)
  assert.equal(miner.roleGranted, 1)
  const granted = signCtx.sent.find((row) => row.text?.includes('community access granted'))
  assert.match(granted.text, /Open DATUM Gateway/)
  assert.equal(granted.extra.reply_markup.inline_keyboard[0][0].text, 'Open DATUM Gateway')
  assert.equal(granted.extra.reply_markup.inline_keyboard[0][0].url, 'https://t.me/c/123456/99')
  assert.ok(signCtx.sent.some((row) => row.text?.includes('Verification passed')))
  cleanup(file, db)
})

test('a signature match with no DATUM shares does not open the community', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-miss-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const config = { challengeMinutes: 30, chatId: '-100' }
  const { privateKey, key, address } = wallet()
  await onStart(fakeCtx(7), { db, config, api: apiStub() })
  const addressCtx = fakeCtx(7, address)
  await onTextMessage(addressCtx, { db, config, api: apiStub() })
  const message = addressCtx.sent.find((row) => row.text?.includes('Access request — template 2 of 2')).text.match(/Sign this exact text[\s\S]*?<pre>([\s\S]*?)<\/pre>/)[1]
  const signature = bitcoinMessage.sign(message, privateKey, key.compressed, { segwitType: 'p2wpkh' }).toString('base64')
  let granted = false
  const signCtx = fakeCtx(7, signature)
  await onTextMessage(signCtx, {
    db,
    config,
    api: apiStub(),
    scanAddress: async () => datumMiss(),
    grantAccess: async () => { granted = true },
  })
  assert.equal(granted, false)
  assert.equal(getMiner(db, '7'), undefined)
  assert.match(signCtx.sent.at(-1).text, /no DATUM shares yet/)
  cleanup(file, db)
})

test('worker suffixes and addresses owned by someone else are rejected', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-reject-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const config = { challengeMinutes: 30, chatId: '-100' }
  const { address } = wallet()
  saveMiner(db, {
    telegramId: '1',
    address,
    addressType: 'p2wpkh',
    signature: 'sig',
    verifiedAt: 1,
    roleGranted: true,
  })
  await onStart(fakeCtx(2), { db, config, api: apiStub() })
  const taken = fakeCtx(2, address)
  await onTextMessage(taken, { db, config, api: apiStub() })
  assert.match(taken.sent.at(-1).text, /another Telegram user/)

  const worker = fakeCtx(2, `${address}.rig1`)
  await onTextMessage(worker, { db, config, api: apiStub() })
  assert.match(worker.sent.at(-1).text, /worker suffix/)
  cleanup(file, db)
})

function saveMiner(db, row) {
  db.prepare(`
    INSERT INTO miners (telegram_id, address, address_type, signature, verified_at, role_granted)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(row.telegramId, row.address, row.addressType, row.signature, row.verifiedAt, row.roleGranted ? 1 : 0)
}

test('linked miners get a restore menu instead of a new signature challenge', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-menu-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const { address } = wallet()
  saveMiner(db, {
    telegramId: '9',
    address,
    addressType: 'p2wpkh',
    signature: 'sig',
    verifiedAt: 1,
    roleGranted: false,
  })
  const ctx = fakeCtx(9)
  await onStart(ctx, { db, config: { challengeMinutes: 30, chatId: '-100' }, api: apiStub() })
  assert.match(ctx.sent.at(-1).text, /Restore access/)
  assert.equal(ctx.sent.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data, 'verify:restore')
  cleanup(file, db)
})

test('restore grants only when the coupled address still has DATUM shares', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-restore-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const { address } = wallet()
  saveMiner(db, {
    telegramId: '11',
    address,
    addressType: 'p2wpkh',
    signature: 'sig',
    verifiedAt: 1,
    roleGranted: false,
  })
  let scanned = null
  const deny = fakeCtx(11)
  await onRestore(deny, {
    db,
    config: { chatId: '-100' },
    api: {},
    scanAddress: async (target) => {
      scanned = target
      return {
        activeDatum: false,
        conclusive: true,
        results: [{ id: 'omega', name: 'OmegaPool', ok: true, activeDatum: false, detail: 'idle' }],
      }
    },
    revokeAccess: async () => {},
    grantAccess: async () => { throw new Error('should not grant') },
  })
  assert.equal(scanned, address)
  assert.match(deny.sent.at(-1).text, /Access not restored/)
  assert.equal(getMiner(db, '11').roleGranted, 0)

  const grant = fakeCtx(11)
  await onRestore(grant, {
    db,
    config: { chatId: '-100' },
    api: {},
    scanAddress: async () => ({
      activeDatum: true,
      conclusive: true,
      results: [{ id: 'riptide', name: 'RIPTide', ok: true, activeDatum: true, detail: 'DATUM shares' }],
    }),
    grantAccess: async () => ({ granted: true, inviteLink: 'https://t.me/+back', note: 'Your join request was approved.' }),
  })
  assert.match(grant.sent.at(-1).text, /Access restored/)
  assert.equal(grant.sent.at(-1).extra.reply_markup.inline_keyboard[0][0].url, 'https://t.me/+back')
  assert.equal(getMiner(db, '11').roleGranted, 1)
  cleanup(file, db)
})

test('template fields are read from filled Address and Signature lines', () => {
  const both = parseTemplateFields('Address: bc1qabc\nSignature: BASE64==')
  assert.equal(both.address, 'bc1qabc')
  assert.equal(both.signature, 'BASE64==')
  const raw = parseTemplateFields('bc1qonly')
  assert.equal(raw.address, null)
  assert.equal(raw.raw, 'bc1qonly')
  const blank = parseTemplateFields('Address: PASTE_YOUR_PUBLIC_WALLET_HERE')
  assert.equal(blank.address, null)
})

test('community links open the Telegram group', () => {
  assert.equal(communityTopicUrl('-100123456', 99), 'https://t.me/c/123456/99')
  assert.equal(communityTopicUrl('-100123456'), 'https://t.me/c/123456')
  assert.equal(communityTopicUrl('-100'), null)
})

test('a group Verify tap sends the address template privately', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-dm-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const ctx = fakeCtx(3, undefined, { privateChat: false })
  ctx.callbackQuery = { id: '1' }
  const api = apiStub(ctx.sent)
  await onStart(ctx, {
    db,
    config: { challengeMinutes: 30, chatId: '-100', webAppUrl: 'https://yudikorsou.github.io/datum-gateway-telegram-verify-bot/' },
    api,
  })
  const form = ctx.sent.find((row) => row.text?.includes('DATUM Gateway verification'))
  assert.match(form.text, /Open DATUM verification/)
  assert.match(form.extra.reply_markup.inline_keyboard[0][0].web_app.url, /v=bip322/)
  assert.match(form.extra.reply_markup.inline_keyboard[0][0].web_app.url, /uid=3/)
  assert.match(ctx.sent.find((row) => row.callback).callback.text, /Private form sent/)
  cleanup(file, db)
})

test('web app fields submit the wallet and signature without typing in chat', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-webapp-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const config = { challengeMinutes: 30, chatId: '-100', webAppUrl: 'https://example.test/form/' }
  const { privateKey, key, address } = wallet()
  await onStart(fakeCtx(55), { db, config, api: apiStub() })

  const addressCtx = fakeCtx(55)
  addressCtx.message = { web_app_data: { data: JSON.stringify({ type: 'address', address }) } }
  await onWebAppData(addressCtx, { db, config, api: apiStub() })
  const challenge = addressCtx.sent.find((row) => row.text?.includes('Access request — template 2 of 2')).text
  const message = challenge.match(/Sign this exact text[\s\S]*?<pre>([\s\S]*?)<\/pre>/)[1]
  const signature = bitcoinMessage.sign(message, privateKey, key.compressed, { segwitType: 'p2wpkh' }).toString('base64')

  const signCtx = fakeCtx(55)
  signCtx.message = { web_app_data: { data: JSON.stringify({ type: 'signature', signature }) } }
  await onWebAppData(signCtx, {
    db,
    config,
    api: apiStub(),
    scanAddress: async () => datumHit(),
    grantAccess: async () => ({ granted: true, inviteLink: null, note: 'You can send messages in the community now.' }),
  })
  assert.match(signCtx.sent.at(-1).text, /community access granted/)
  cleanup(file, db)
})

test('pasted proof JSON is treated like the Mini App submit', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-json-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const config = { challengeMinutes: 30, chatId: '-100', webAppUrl: 'https://example.test/form/' }
  const { privateKey, key, address } = wallet()
  const issued = new Date().toISOString()
  const nonce = 'cd'.repeat(16)
  const message = challengeMessage({ telegramId: '77', address, nonce, issued })
  const signature = bitcoinMessage.sign(message, privateKey, key.compressed, { segwitType: 'p2wpkh' }).toString('base64')
  const ctx = fakeCtx(77, JSON.stringify({ type: 'proof', address, signature, nonce, issued }))
  await onTextMessage(ctx, {
    db,
    config,
    api: apiStub(),
    scanAddress: async () => datumHit(),
    grantAccess: async () => ({ granted: true, inviteLink: null, note: 'You can send messages in the community now.' }),
  })
  assert.match(ctx.sent.at(-1).text, /community access granted/)
  assert.equal(getMiner(db, '77').roleGranted, 1)
  cleanup(file, db)
})

test('one form can send the wallet and signature together', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-proof-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const config = { challengeMinutes: 30, chatId: '-100', webAppUrl: 'https://example.test/form/' }
  const { privateKey, key, address } = wallet()
  const issued = new Date().toISOString()
  const nonce = 'ab'.repeat(16)
  const message = challengeMessage({ telegramId: '66', address, nonce, issued })
  const signature = bitcoinMessage.sign(message, privateKey, key.compressed, { segwitType: 'p2wpkh' }).toString('base64')
  const ctx = fakeCtx(66)
  ctx.message = { web_app_data: { data: JSON.stringify({ type: 'proof', address, signature, nonce, issued }) } }
  await onWebAppData(ctx, {
    db,
    config,
    api: apiStub(),
    scanAddress: async () => datumHit(),
    grantAccess: async () => ({ granted: true, inviteLink: null, note: 'You can send messages in the community now.' }),
  })
  assert.match(ctx.sent.at(-1).text, /community access granted/)
  assert.equal(getMiner(db, '66').roleGranted, 1)
  cleanup(file, db)
})

test('a wrapped BIP322 Taproot signature submitted from the Mini App grants access', async () => {
  const file = path.join(os.tmpdir(), `datum-flow-bip322-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
  const db = openDatabase(file)
  const config = { challengeMinutes: 30, chatId: '-100', webAppUrl: 'https://example.test/form/' }
  const key = ECPair.makeRandom()
  const pubkey = Buffer.from(key.publicKey)
  const address = payments.p2tr({ internalPubkey: pubkey.slice(1, 33), network: networks.bitcoin }).address
  const issued = new Date().toISOString()
  const nonce = 'ef'.repeat(16)
  const message = challengeMessage({ telegramId: '88', address, nonce, issued })
  const signature = Signer.sign(key.toWIF(), address, message)
  const wrapped = signature.match(/.{1,64}/g).join('\n')
  const ctx = fakeCtx(88)
  ctx.message = { web_app_data: { data: JSON.stringify({ type: 'proof', address, signature: wrapped, nonce, issued }) } }
  await onWebAppData(ctx, {
    db,
    config,
    api: apiStub(),
    scanAddress: async () => datumHit(),
    grantAccess: async () => ({ granted: true, inviteLink: null, note: 'You can send messages in the community now.' }),
  })
  assert.match(ctx.sent.at(-1).text, /community access granted/)
  assert.equal(getMiner(db, '88').roleGranted, 1)
  assert.equal(getMiner(db, '88').addressType, 'p2tr')
  cleanup(file, db)
})
