import { accessErrorText, grantAccess, grantAccessInCommunities, muteMember, revokeAccess, revokeAccessInCommunities } from './access.js'
import { configuredChatIds } from './config.js'
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
  recordScan,
  saveChallenge,
  saveJoinRequest,
  saveMiner,
  saveSession,
} from './db.js'
import {
  addressTemplate,
  communityOpenKeyboard,
  communityTopicUrl,
  datumKeyboard,
  groupLockedText,
  groupUnlockedText,
  menuKeyboard,
  menuText,
  openBotFirstText,
  parseTemplateFields,
  restoreResultText,
  scanResultText,
  signatureTemplate,
  statusText,
  useGroupText,
  verifyKeyboard,
  welcomeText,
} from './present.js'
import { scanAddress as scanAddressDefault, summarizeScan } from './pools/scan.js'
import { verifyOwnership } from './signature.js'
import { restoreDecision } from './verify-step.js'
import { addressFormMarkup, parseWebAppData, removeWebAppKeyboard, signatureFormMarkup, verifyAppReplyMarkup } from './webapp.js'

function telegramId(ctx) {
  return String(ctx.from.id)
}

function isPrivate(ctx) {
  return ctx.chat?.type === 'private'
}

function inCommunity(ctx, config) {
  const chatId = String(ctx.chat?.id || '')
  return configuredChatIds(config).includes(chatId)
}

async function say(ctx, html, extra = {}) {
  await ctx.reply(html, { parse_mode: 'HTML', ...extra })
}

async function sayPrivate(ctx, { api, config }, html, extra = {}) {
  const send = async (payload) => {
    if (isPrivate(ctx)) return ctx.reply(html, payload)
    return api.sendMessage(telegramId(ctx), html, payload)
  }
  try {
    await send({ parse_mode: 'HTML', ...extra })
    return true
  } catch (error) {
    if (extra.reply_markup) {
      try {
        await send({ parse_mode: 'HTML' })
        return true
      } catch { /* keep the original error */ }
    }
    console.error(`could not send private form to ${telegramId(ctx)}`, error?.description || error?.message)
    if (ctx.callbackQuery) {
      try { await ctx.answerCallbackQuery({ text: openBotFirstText(), show_alert: true }) } catch { /* already replied */ }
    } else if (inCommunity(ctx, config)) {
      await say(ctx, openBotFirstText(), { reply_markup: verifyKeyboard() })
    }
    return false
  }
}

async function sayGroupQuiet(ctx, config, html) {
  if (!inCommunity(ctx, config)) return
  await say(ctx, html, { reply_markup: verifyKeyboard() })
}

async function communityOpenUrl(deps, inviteLink) {
  if (inviteLink && /^https:\/\/t\.me\//i.test(inviteLink)) return inviteLink
  const { api, config } = deps
  const chatId = configuredChatIds(config)[0]
  if (!chatId) return null
  try {
    const posted = await api.sendMessage(chatId, groupUnlockedText(), { parse_mode: 'HTML' })
    return communityTopicUrl(chatId, posted?.message_id) || communityTopicUrl(chatId)
  } catch (error) {
    console.error('could not post community unlock', error?.description || error?.message)
    return communityTopicUrl(chatId)
  }
}

async function muteEverywhere(api, config, id) {
  for (const chatId of configuredChatIds(config)) {
    try {
      await muteMember(api, config, id, chatId)
    } catch {
      // Keep going across communities.
    }
  }
}

function grantedAccessMarkup(openUrl) {
  return communityOpenKeyboard(openUrl) || removeWebAppKeyboard()
}

function beginChallenge(db, config, id, info, extras = {}) {
  const owner = addressOwner(db, info.canonical)
  if (owner && owner.telegramId !== id) {
    return { error: 'That address is already linked to another Telegram user.' }
  }
  const challenge = createChallenge({
    telegramId: id,
    address: info.canonical,
    nonce: extras.nonce,
    issued: extras.issued,
  })
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

async function attachMiniAppKeyboard(ctx, deps) {
  const markup = verifyAppReplyMarkup(deps.config, telegramId(ctx))
  if (!markup) return
  try {
    const payload = {
      parse_mode: 'HTML',
      reply_markup: markup,
    }
    const html = 'If you close the Mini App, tap <b>Open DATUM verification</b> under the chat to open the Bitcoin address field again.'
    if (isPrivate(ctx)) await ctx.reply(html, payload)
    else await deps.api.sendMessage(telegramId(ctx), html, payload)
  } catch (error) {
    console.error('could not attach mini app keyboard', error?.description || error?.message)
  }
}

async function beginAddressStep(ctx, deps) {
  const { db, config } = deps
  saveSession(db, { telegramId: telegramId(ctx), phase: 'address', updatedAt: Date.now() })
  const sent = await sayPrivate(ctx, deps, addressTemplate(), { reply_markup: addressFormMarkup(config, telegramId(ctx)) })
  if (sent) await attachMiniAppKeyboard(ctx, deps)
  return sent
}

export async function onStart(ctx, deps) {
  const { db, config } = deps
  const miner = getMiner(db, telegramId(ctx))
  if (ctx.callbackQuery && !isPrivate(ctx)) {
    const sent = miner
      ? await sayPrivate(ctx, deps, menuText(miner), { reply_markup: menuKeyboard() })
      : await beginAddressStep(ctx, deps)
    if (sent) {
      await ctx.answerCallbackQuery?.({ text: 'Private form sent. Only you can see it.' })
    }
    return
  }
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery?.({ text: 'Fill the private form.' })
  }
  if (isPrivate(ctx)) {
    if (miner) {
      await say(ctx, menuText(miner), { reply_markup: menuKeyboard() })
      return
    }
    await beginAddressStep(ctx, deps)
    return
  }
  if (!inCommunity(ctx, config)) return
  if (miner) {
    const sent = await sayPrivate(ctx, deps, menuText(miner), { reply_markup: menuKeyboard() })
    if (sent) await sayGroupQuiet(ctx, config, 'A private form was sent to you. Other members cannot see it.')
    return
  }
  const sent = await beginAddressStep(ctx, deps)
  if (sent) await sayGroupQuiet(ctx, config, 'A private form was sent to you. Other members cannot see it.')
}

export async function onCancel(ctx, deps) {
  const { db, config, api } = deps
  if (!isPrivate(ctx) && !inCommunity(ctx, config)) return
  const id = telegramId(ctx)
  deleteSession(db, id)
  deleteChallenge(db, id)
  const miner = getMiner(db, id)
  if (!miner?.roleGranted) {
    try { await muteMember(api, config, id) } catch { /* still cancel the proof */ }
  }
  await sayPrivate(ctx, deps, 'Verification cancelled. Send /verify or tap <b>Verify</b> for a new private form.')
}

export async function onStatus(ctx, deps) {
  const { db, config } = deps
  if (!isPrivate(ctx) && !inCommunity(ctx, config)) return
  const miner = getMiner(db, telegramId(ctx))
  if (!miner) {
    await sayPrivate(ctx, deps, 'You are not verified yet. Fill the private address form.', { reply_markup: verifyKeyboard() })
    return
  }
  await sayPrivate(ctx, deps, statusText(miner), { reply_markup: menuKeyboard() })
}

export async function onUnlink(ctx, deps) {
  const { db, config, api } = deps
  if (!isPrivate(ctx) && !inCommunity(ctx, config)) return
  const id = telegramId(ctx)
  const miner = getMiner(db, id)
  if (!miner) {
    await sayPrivate(ctx, deps, 'You do not have a linked address.')
    return
  }
  try {
    await revokeAccessInCommunities(api, config, id)
  } catch (error) {
    await sayPrivate(ctx, deps, escapeFallback(accessErrorText(error)))
    return
  }
  deleteMiner(db, id)
  deleteChallenge(db, id)
  deleteSession(db, id)
  deleteJoinRequest(db, id)
  await sayPrivate(ctx, deps, `Unlinked <code>${miner.address}</code>. Sending is locked until you verify again.`, { reply_markup: verifyKeyboard() })
  if (inCommunity(ctx, config)) await sayGroupQuiet(ctx, config, groupLockedText())
}

function escapeFallback(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export async function onChatId(ctx) {
  if (isPrivate(ctx)) {
    await say(ctx, 'Add the bot to each community and send /chatid there. Add every chat id in Umbrel or TELEGRAM_CHAT_IDS.')
    return
  }
  console.log(`TELEGRAM_CHAT_ID=${ctx.chat.id}`)
  await say(ctx, `Chat id: <code>${ctx.chat.id}</code>\nAdd this id to your communities list so the bot can verify miners here.`)
}

export async function onTextMessage(ctx, deps) {
  if (!isPrivate(ctx)) return
  const text = ctx.message?.text?.trim()
  if (!text || text.startsWith('/')) return
  const parsed = parseWebAppData(text)
  if (parsed?.type === 'proof' || parsed?.type === 'signature' || parsed?.type === 'address') {
    ctx.message.web_app_data = { data: text }
    await onWebAppData(ctx, deps)
    return
  }
  const id = telegramId(ctx)
  const phase = getSession(deps.db, id)?.phase
  const fields = parseTemplateFields(text)
  if (phase === 'signature') {
    await submitSignature(ctx, deps, fields.signature || fields.raw)
    return
  }
  if (phase === 'datum') {
    await say(ctx, 'Ownership is already confirmed. Tap <b>Check DATUM shares</b>, or send /verify for a new private form.', { reply_markup: datumKeyboard() })
    return
  }
  if (phase !== 'address') {
    await say(ctx, useGroupText(), { reply_markup: verifyKeyboard() })
    return
  }
  const address = fields.address || fields.raw
  await submitAddress(ctx, deps, address)
  if (fields.address && fields.signature) {
    await submitSignature(ctx, deps, fields.signature)
  }
}

async function submitAddress(ctx, deps, text, extras = {}) {
  const { db, config } = deps
  const info = inspectAddress(text)
  if (!info.ok) {
    await sayPrivate(ctx, deps, escapeFallback(info.error), { reply_markup: addressFormMarkup(config, telegramId(ctx)) })
    return null
  }
  const started = beginChallenge(db, config, telegramId(ctx), info, extras)
  if (started.error) {
    await sayPrivate(ctx, deps, escapeFallback(started.error), { reply_markup: verifyKeyboard() })
    return null
  }
  if (!extras.silent) {
    const sent = await sayPrivate(ctx, deps, signatureTemplate(started.info, started.message), {
      reply_markup: signatureFormMarkup(config, telegramId(ctx)),
    })
    if (sent) await attachMiniAppKeyboard(ctx, deps)
  }
  return started
}

export async function onWebAppData(ctx, deps) {
  try {
    if (!isPrivate(ctx)) return
    const raw = ctx.message?.web_app_data?.data
    console.log(`web app form received (${String(raw || '').length} chars)`)
    const parsed = parseWebAppData(raw)
    if (!parsed) {
      await say(ctx, 'That form was empty. Open the paste field again and submit it.')
      return
    }
    if (parsed.type === 'proof' || parsed.type === 'signature') {
      await say(ctx, 'Got the form. Checking the signature, then DATUM Gateway shares…', {
        reply_markup: removeWebAppKeyboard(),
      })
    }
    if (parsed.type === 'proof') {
      const started = await submitAddress(ctx, deps, parsed.address, {
        nonce: parsed.nonce,
        issued: parsed.issued,
        silent: true,
      })
      if (!started?.message) return
      await submitSignature(ctx, deps, parsed.signature)
      return
    }
    if (parsed.type === 'address') {
      await submitAddress(ctx, deps, parsed.address)
      return
    }
    await submitSignature(ctx, deps, parsed.signature)
  } catch (error) {
    console.error('web app form failed', error)
    try {
      await say(ctx, 'The bot could not finish that check. Send /verify and submit the form again.')
    } catch { /* already logged */ }
  }
}

async function submitSignature(ctx, deps, text) {
  const { db, config, api } = deps
  const id = telegramId(ctx)
  const challenge = getChallenge(db, id)
  if (!challenge) {
    deleteSession(db, id)
    await sayPrivate(ctx, deps, 'Send /verify for a new private form.', { reply_markup: verifyKeyboard() })
    return
  }
  if (challenge.expiresAt < Date.now()) {
    deleteChallenge(db, id)
    saveSession(db, { telegramId: id, phase: 'address', updatedAt: Date.now() })
    await sayPrivate(ctx, deps, 'That form expired. Paste the public wallet again.', { reply_markup: addressFormMarkup(config, telegramId(ctx)) })
    return
  }
  const proof = verifyOwnership(challenge.address, challenge.message, text)
  if (!proof.ok) {
    await sayPrivate(ctx, deps, [
      '<b>Verification failed</b>',
      '',
      escapeFallback(proof.reason),
      '',
      'Tap <b>Open DATUM verification</b> on this message and submit the signature in the Mini App again.',
    ].join('\n'), {
      reply_markup: signatureFormMarkup(config, id),
    })
    return
  }
  const info = inspectAddress(challenge.address)
  markOwnershipProven(db, id, {
    signature: text.trim(),
    expiresAt: Date.now() + config.challengeMinutes * 60 * 1000,
  })
  saveSession(db, { telegramId: id, phase: 'datum', updatedAt: Date.now() })
  try { await muteEverywhere(api, config, id) } catch { /* DATUM check is next */ }
  await sayPrivate(ctx, deps, [
    '<b>Address proved</b>',
    '',
    `The signature matches <code>${escapeFallback(info.canonical)}</code>. Checking whether this address is hashing through a DATUM Gateway now.`,
  ].join('\n'))
  await runDatumCheck(ctx, deps)
}

export async function onDatumCheck(ctx, deps) {
  if (!isPrivate(ctx) && !inCommunity(ctx, deps.config)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Open the private form from Verify.' })
    return
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Checking pools…' })
  await runDatumCheck(ctx, deps)
}

async function runDatumCheck(ctx, deps) {
  const { db, config } = deps
  const scanAddress = deps.scanAddress || scanAddressDefault
  const grant = deps.grantAccess || grantAccessInCommunities
  const id = telegramId(ctx)
  const challenge = getChallenge(db, id)
  if (!challenge || challenge.phase !== 'datum' || !challenge.signature) {
    await sayPrivate(ctx, deps, 'Prove address ownership first. Send /verify for a private form.', { reply_markup: verifyKeyboard() })
    return
  }
  if (challenge.expiresAt < Date.now()) {
    deleteChallenge(db, id)
    saveSession(db, { telegramId: id, phase: 'address', updatedAt: Date.now() })
    await sayPrivate(ctx, deps, 'That check expired. Send /verify for a new private form.', { reply_markup: verifyKeyboard() })
    return
  }

  const scan = await scanAddress(challenge.address, config)
  const lines = summarizeScan(scan)
  if (!scan.activeDatum) {
    try { await muteEverywhere(deps.api, config, id) } catch { /* keep the DATUM button */ }
    await sayPrivate(ctx, deps, scanResultText({
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
    await sayPrivate(ctx, deps, [
      '<b>Shares confirmed — community access failed</b>',
      '',
      escapeFallback(roleNote || 'Telegram did not open the community.'),
      '',
      'The address proof is still valid. Tap <b>Check DATUM shares</b> again after the bot can unlock sending.',
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
  const openUrl = await communityOpenUrl(deps, inviteLink)
  await sayPrivate(ctx, deps, scanResultText({ granted: roleGranted, lines, roleNote, inviteLink: inviteLink || openUrl }), {
    reply_markup: grantedAccessMarkup(openUrl),
  })
}

export async function onRestore(ctx, deps) {
  if (!isPrivate(ctx) && !inCommunity(ctx, deps.config)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Open the private form from Verify.' })
    return
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Checking the linked address…' })
  const { db, config } = deps
  const scanAddress = deps.scanAddress || scanAddressDefault
  const grant = deps.grantAccess || grantAccessInCommunities
  const revoke = deps.revokeAccess || revokeAccessInCommunities
  const id = telegramId(ctx)
  const miner = getMiner(db, id)
  if (!miner) {
    await sayPrivate(ctx, deps, 'No address is coupled yet. Use <b>Sign again</b> or <b>Add another wallet</b> in the private form.', { reply_markup: menuKeyboard() })
    return
  }
  const address = miner.address
  const owner = addressOwner(db, address)
  if (owner && owner.telegramId !== id) {
    await sayPrivate(ctx, deps, 'That address is already linked to another Telegram user.', { reply_markup: menuKeyboard() })
    return
  }
  const scan = await scanAddress(address, config)
  const lines = summarizeScan(scan)
  const decision = restoreDecision(scan)
  if (decision !== 'grant') {
    if (decision === 'deny') {
      try {
        await revoke(deps.api, config, id)
      } catch (error) {
        await sayPrivate(ctx, deps, escapeFallback(accessErrorText(error)), { reply_markup: menuKeyboard() })
        return
      }
      recordScan(db, id, { roleGranted: false, scannedAt: Date.now(), scan })
    }
    await sayPrivate(ctx, deps, restoreResultText({
      granted: false,
      address,
      lines,
      roleNote: decision === 'deny'
        ? 'Every pool answered. This linked address is not hashing through a DATUM Gateway, so access was not restored.'
        : 'A pool did not answer, so this check is not treated as a no. Access was not changed. Try again when that pool is reachable.',
    }), { reply_markup: menuKeyboard() })
    return
  }

  let granted = false
  let roleNote = null
  let inviteLink = null
  try {
    const access = await grant(deps.api, config, id)
    granted = access.granted
    roleNote = access.note
    inviteLink = access.inviteLink
    if (access.granted) deleteJoinRequest(db, id)
  } catch (error) {
    roleNote = accessErrorText(error)
  }
  if (!granted) {
    await sayPrivate(ctx, deps, restoreResultText({
      granted: false,
      address,
      lines,
      roleNote: roleNote || 'Telegram did not open the community.',
    }), { reply_markup: menuKeyboard() })
    return
  }
  recordScan(db, id, { roleGranted: true, scannedAt: Date.now(), scan })
  const openUrl = await communityOpenUrl(deps, inviteLink)
  await sayPrivate(ctx, deps, restoreResultText({
    granted: true,
    address,
    lines,
    roleNote: roleNote || 'Access is restored only while this linked address keeps hashing through DATUM Gateway.',
    inviteLink: inviteLink || openUrl,
  }), { reply_markup: communityOpenKeyboard(openUrl) || menuKeyboard() })
}

export async function onSignAgain(ctx, deps) {
  if (!isPrivate(ctx) && !inCommunity(ctx, deps.config)) {
    await ctx.answerCallbackQuery?.({ text: 'Open the private form from Verify.' })
    return
  }
  await ctx.answerCallbackQuery?.({ text: 'Open DATUM verification Mini App.' })
  await beginAddressStep(ctx, deps)
}

export async function onAddWallet(ctx, deps) {
  if (!isPrivate(ctx) && !inCommunity(ctx, deps.config)) {
    await ctx.answerCallbackQuery?.({ text: 'Open the private form from Verify.' })
    return
  }
  await ctx.answerCallbackQuery?.({ text: 'Private address form sent.' })
  await beginAddressStep(ctx, deps)
}

export async function onJoinRequest(ctx, { db, config, api }) {
  const request = ctx.chatJoinRequest
  if (!request || !configuredChatIds(config).includes(String(request.chat.id))) return
  const id = String(request.from.id)
  const chatId = String(request.chat.id)
  saveJoinRequest(db, { telegramId: id, chatId, requestedAt: Date.now() })
  try {
    await api.approveChatJoinRequest(chatId, request.from.id)
    deleteJoinRequest(db, id)
  } catch (error) {
    console.error(`could not approve join request for ${id}`, error?.description || error?.message)
  }
}

export async function onChatMember(ctx, { db, config, api }) {
  const update = ctx.chatMember
  if (!update || !configuredChatIds(config).includes(String(update.chat.id))) return
  const next = update.new_chat_member
  const previous = update.old_chat_member?.status
  if (!next?.user || next.user.is_bot) return
  const id = String(next.user.id)
  const chatId = String(update.chat.id)
  if (next.status !== 'member' && next.status !== 'restricted') return
  const miner = getMiner(db, id)
  try {
    if (miner?.roleGranted) await grantAccess(api, config, id, { inviteIfAbsent: false, chatId })
    else await muteMember(api, config, id, chatId)
  } catch (error) {
    console.error(`could not sync speak rights for ${id}`, error?.description || error?.message)
  }
  if (previous !== 'left' && previous !== 'kicked') return
  const name = [next.user.first_name, next.user.last_name].filter(Boolean).join(' ')
  try {
    await api.sendMessage(chatId, welcomeText(name), {
      parse_mode: 'HTML',
      reply_markup: miner ? menuKeyboard() : verifyKeyboard(),
    })
  } catch (error) {
    console.error(`could not welcome ${id}`, error?.description || error?.message)
  }
}

