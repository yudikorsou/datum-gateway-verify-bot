import { accessErrorText, grantAccess, revokeAccess } from './access.js'
import { inspectAddress } from './address.js'
import { createChallenge } from './challenge.js'
import {
  addressOwner,
  deleteChallenge,
  deleteJoinRequest,
  deleteMiner,
  deleteSession,
  getChallenge,
  getMiner,
  getSession,
  markOwnershipProven,
  saveChallenge,
  saveJoinRequest,
  saveMiner,
  saveSession,
} from './db.js'
import {
  askAddressText,
  challengeText,
  datumKeyboard,
  ownershipConfirmedText,
  privateOnlyText,
  scanResultText,
  statusText,
} from './present.js'
import { scanAddress as scanAddressDefault, summarizeScan } from './pools/scan.js'
import { verifyOwnership } from './signature.js'

function telegramId(ctx) {
  return String(ctx.from.id)
}

function isPrivate(ctx) {
  return ctx.chat?.type === 'private'
}

async function say(ctx, html, extra = {}) {
  await ctx.reply(html, { parse_mode: 'HTML', ...extra })
}

function beginChallenge(db, config, id, info) {
  const owner = addressOwner(db, info.canonical)
  if (owner && owner.telegramId !== id) {
    return { error: 'That address is already linked to another Telegram user.' }
  }
  const challenge = createChallenge({ telegramId: id, address: info.canonical })
  saveChallenge(db, {
    telegramId: id,
    address: info.canonical,
    message: challenge.message,
    nonce: challenge.nonce,
    expiresAt: Date.now() + config.challengeMinutes * 60 * 1000,
    phase: 'signature',
    signature: null,
  })
  saveSession(db, { telegramId: id, phase: 'signature', updatedAt: Date.now() })
  return { info, message: challenge.message }
}

export async function onStart(ctx, { db }) {
  if (!isPrivate(ctx)) {
    await say(ctx, privateOnlyText())
    return
  }
  saveSession(db, { telegramId: telegramId(ctx), phase: 'address', updatedAt: Date.now() })
  await say(ctx, askAddressText())
}

export async function onCancel(ctx, { db }) {
  if (!isPrivate(ctx)) return
  const id = telegramId(ctx)
  deleteSession(db, id)
  deleteChallenge(db, id)
  await say(ctx, 'Verification cancelled. Send /verify to start again.')
}

export async function onStatus(ctx, { db }) {
  if (!isPrivate(ctx)) {
    await say(ctx, privateOnlyText())
    return
  }
  const miner = getMiner(db, telegramId(ctx))
  if (!miner) {
    await say(ctx, 'You are not verified yet. Send /verify.')
    return
  }
  await say(ctx, statusText(miner))
}

export async function onUnlink(ctx, { db, config, api }) {
  if (!isPrivate(ctx)) {
    await say(ctx, privateOnlyText())
    return
  }
  const id = telegramId(ctx)
  const miner = getMiner(db, id)
  if (!miner) {
    await say(ctx, 'You do not have a linked address.')
    return
  }
  try {
    await revokeAccess(api, config, id)
  } catch (error) {
    await say(ctx, escapeFallback(accessErrorText(error)))
    return
  }
  deleteMiner(db, id)
  deleteChallenge(db, id)
  deleteSession(db, id)
  deleteJoinRequest(db, id)
  await say(ctx, `Unlinked <code>${miner.address}</code> and removed community access.`)
}

function escapeFallback(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export async function onChatId(ctx) {
  if (isPrivate(ctx)) {
    await say(ctx, 'Add the bot to the community and send /chatid there. The reply is the value for <code>TELEGRAM_CHAT_ID</code>.')
    return
  }
  await say(ctx, `Chat id: <code>${ctx.chat.id}</code>`)
}

export async function onPrivateTextMessage(ctx, deps) {
  if (!isPrivate(ctx)) return
  const text = ctx.message?.text?.trim()
  if (!text || text.startsWith('/')) return
  const id = telegramId(ctx)
  const phase = getSession(deps.db, id)?.phase
  if (phase === 'signature') {
    await submitSignature(ctx, deps, text)
    return
  }
  if (phase === 'datum') {
    await say(ctx, 'Ownership is already confirmed. Tap <b>Check DATUM shares</b>, or send /verify to start over.')
    return
  }
  if (phase !== 'address') {
    await say(ctx, 'Send /verify to start.')
    return
  }
  await submitAddress(ctx, deps, text)
}

async function submitAddress(ctx, { db, config }, text) {
  const info = inspectAddress(text)
  if (!info.ok) {
    await say(ctx, escapeFallback(info.error))
    return
  }
  const started = beginChallenge(db, config, telegramId(ctx), info)
  if (started.error) {
    await say(ctx, escapeFallback(started.error))
    return
  }
  await say(ctx, challengeText(started.info, started.message))
}

async function submitSignature(ctx, { db, config }, text) {
  const id = telegramId(ctx)
  const challenge = getChallenge(db, id)
  if (!challenge) {
    deleteSession(db, id)
    await say(ctx, 'Start with /verify and sign the message the bot gives you.')
    return
  }
  if (challenge.expiresAt < Date.now()) {
    deleteChallenge(db, id)
    saveSession(db, { telegramId: id, phase: 'address', updatedAt: Date.now() })
    await say(ctx, 'That challenge expired. Send the address again, or /verify for a fresh message.')
    return
  }
  const proof = verifyOwnership(challenge.address, challenge.message, text)
  if (!proof.ok) {
    await say(ctx, `<b>Verification failed</b>\n\n${escapeFallback(proof.reason)}`)
    return
  }
  const info = inspectAddress(challenge.address)
  markOwnershipProven(db, id, {
    signature: text.trim(),
    expiresAt: Date.now() + config.challengeMinutes * 60 * 1000,
  })
  saveSession(db, { telegramId: id, phase: 'datum', updatedAt: Date.now() })
  await say(ctx, ownershipConfirmedText(info), { reply_markup: datumKeyboard() })
}

export async function onDatumCheck(ctx, deps) {
  if (!isPrivate(ctx)) {
    await ctx.answerCallbackQuery?.({ text: 'Open a private chat with the bot.' })
    return
  }
  await ctx.answerCallbackQuery?.({ text: 'Checking pools…' })
  const { db, config } = deps
  const scanAddress = deps.scanAddress || scanAddressDefault
  const grant = deps.grantAccess || grantAccess
  const id = telegramId(ctx)
  const challenge = getChallenge(db, id)
  if (!challenge || challenge.phase !== 'datum' || !challenge.signature) {
    await say(ctx, 'Prove address ownership first. Send /verify.')
    return
  }
  if (challenge.expiresAt < Date.now()) {
    deleteChallenge(db, id)
    saveSession(db, { telegramId: id, phase: 'address', updatedAt: Date.now() })
    await say(ctx, 'That check expired. Send /verify and sign a fresh message.')
    return
  }

  const scan = await scanAddress(challenge.address, config)
  const lines = summarizeScan(scan)
  if (!scan.activeDatum) {
    await say(ctx, scanResultText({
      granted: false,
      lines,
      roleNote: scan.conclusive
        ? 'Every pool answered. None show fresh DATUM shares for this address. You can tap the button again after shares show up.'
        : 'A pool that did not answer is not counted as a no. Tap the button again when it is reachable, or mine through a pool that labels DATUM shares.',
    }), { reply_markup: datumKeyboard() })
    return
  }

  let roleGranted = false
  let roleNote = null
  let inviteLink = null
  try {
    const access = await grant(deps.api, config, id)
    roleGranted = access.granted
    roleNote = access.note
    inviteLink = access.inviteLink
    if (access.granted) deleteJoinRequest(db, id)
  } catch (error) {
    roleNote = accessErrorText(error)
  }
  if (!roleGranted) {
    await say(ctx, [
      '<b>Shares confirmed — community access failed</b>',
      '',
      escapeFallback(roleNote || 'Telegram did not open the community.'),
      '',
      'The address proof is still valid. Tap <b>Check DATUM shares</b> again after the bot can approve members.',
    ].join('\n'), { reply_markup: datumKeyboard() })
    return
  }
  const info = inspectAddress(challenge.address)
  saveMiner(db, {
    telegramId: id,
    address: challenge.address,
    addressType: info.type,
    signature: challenge.signature,
    verifiedAt: Date.now(),
    roleGranted,
    lastScanAt: Date.now(),
    lastScanJson: JSON.stringify(scan),
  })
  deleteChallenge(db, id)
  deleteSession(db, id)
  await say(ctx, scanResultText({ granted: roleGranted, lines, roleNote, inviteLink }))
}

export async function onJoinRequest(ctx, { db, config, api }) {
  const request = ctx.chatJoinRequest
  if (!request || String(request.chat.id) !== String(config.chatId)) return
  const id = String(request.from.id)
  saveJoinRequest(db, { telegramId: id, chatId: String(request.chat.id), requestedAt: Date.now() })
  const miner = getMiner(db, id)
  if (miner?.roleGranted) {
    try {
      await api.approveChatJoinRequest(config.chatId, request.from.id)
      deleteJoinRequest(db, id)
      return
    } catch (error) {
      console.error(`could not approve join request for ${id}`, error?.description || error?.message)
    }
  }
  try {
    await api.sendMessage(
      request.from.id,
      'A join request is waiting. Send /verify here. Access is granted after you prove a Bitcoin address and fresh DATUM Gateway shares. Shrike addresses (1…, 3…, bc1q…, bc1p…) work.',
    )
  } catch (error) {
    console.error(`could not message ${id} about their join request`, error?.description || error?.message)
  }
}

