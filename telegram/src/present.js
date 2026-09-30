export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function verifyKeyboard() {
  return {
    inline_keyboard: [[{ text: 'Verify', callback_data: 'verify:start' }]],
  }
}

export function useGroupText() {
  return [
    'Join the <b>DATUM Gateway</b> group so you can read it.',
    'Tap <b>Verify</b> there. The questions are sent as a private form that only you can see. Other members do not see your address or signature.',
  ].join('\n')
}

export function welcomeText(name) {
  const who = name ? `, ${escapeHtml(name)}` : ''
  return [
    `<b>Welcome${who}</b>`,
    '',
    'You can read this chat. Sending stays locked until you verify.',
    '',
    'Tap <b>Verify</b>. The bot sends you a private form. Other members cannot see those questions or your answers.',
  ].join('\n')
}

export function groupUnlockedText() {
  return 'Verification passed. You can send messages in this chat now.'
}

export function communityTopicUrl(chatId, messageId) {
  const match = String(chatId || '').match(/^-100(\d+)$/)
  if (!match) return null
  const base = `https://t.me/c/${match[1]}`
  return messageId ? `${base}/${messageId}` : base
}

export function communityOpenKeyboard(openUrl) {
  if (!openUrl || !/^https:\/\/t\.me\//i.test(openUrl)) return null
  return {
    inline_keyboard: [[{ text: 'Open DATUM Gateway', url: openUrl }]],
  }
}

export function groupLockedText() {
  return 'Sending is locked again. Tap <b>Verify</b> for a private form after DATUM shares are flowing.'
}

export function openBotFirstText() {
  return 'Open @datumgatewaybot, tap Start, then tap Verify again. The form can only be sent in a private chat with the bot.'
}

function filledValue(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return null
  if (/^PASTE_YOUR_/i.test(trimmed)) return null
  if (/PASTE_/i.test(trimmed) && /_HERE$/i.test(trimmed)) return null
  return trimmed
}

export function parseTemplateFields(text) {
  const raw = String(text || '').trim()
  const addressMatch = raw.match(/^\s*Address:\s*(.+?)\s*$/im)
  const signatureMatch = raw.match(/^\s*Signature:\s*([\s\S]+)$/im)
  return {
    address: filledValue(addressMatch?.[1]),
    signature: filledValue(signatureMatch?.[1]),
    raw,
  }
}

export function addressTemplate() {
  return [
    '<b>DATUM Gateway verification</b>',
    '',
    'Tap <b>Open DATUM verification</b> on this message to open the Bitcoin address field, the signing video, and the signature field.',
    '',
    'Paste your public payout address, continue, copy the sign text into Sparrow or Shrike, paste the signature, then tap <b>Submit and check DATUM</b>.',
    'Telegram only delivers that check from <b>Open DATUM verification</b> under the chat. If you opened from this message, close the Mini App and tap the under-chat button once — your signature is saved and the bot then checks DATUM Gateway pool shares.',
    '',
    'Use a mainnet payout address (<code>1…</code>, <code>3…</code>, <code>bc1q…</code>, or <code>bc1p…</code>). Do not include a <code>.worker</code> suffix.',
  ].join('\n')
}

export function signatureTemplate(info, message) {
  return [
    '<b>Access request — template 2 of 2</b>',
    '',
    'Copy the sign text in the Mini App, create the digital signature in Shrike, then tap <b>Submit and check DATUM</b>. If you opened from this message, close the Mini App and tap <b>Open DATUM verification</b> under the chat so the bot can check DATUM Gateway shares.',
    '',
    `Public wallet: <code>${escapeHtml(info.canonical)}</code>`,
    `Type: ${escapeHtml(info.label)}`,
    '',
    'Sign this exact text (Shrike: Tools → Sign/Verify Message):',
    `<pre>${escapeHtml(message)}</pre>`,
    '<b>Bitcoin Core:</b> <code>signmessage "&lt;address&gt;" "&lt;message&gt;"</code>',
    '<b>Electrum:</b> Tools → Sign/Verify message. Taproot (<code>bc1p…</code>) needs BIP322. This expires in 30 minutes.',
  ].join('\n')
}

export function datumKeyboard() {
  return {
    inline_keyboard: [[{ text: 'Check DATUM shares', callback_data: 'verify:datum' }]],
  }
}

export function menuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Restore access', callback_data: 'verify:restore' }],
      [
        { text: 'Sign again', callback_data: 'verify:sign-again' },
        { text: 'Add another wallet', callback_data: 'verify:new-wallet' },
      ],
    ],
  }
}

export function menuText(miner) {
  return [
    '<b>DATUM Gateway verification</b>',
    '',
    `Linked wallet: <code>${escapeHtml(miner.address)}</code>. You already proved this address, so you do not need a new signature.`,
    '',
    '<b>Restore access</b> checks whether this linked address is still hashing through a DATUM Gateway pool. Access is restored only if a pool still shows DATUM shares.',
    '<b>Sign again</b> only if you want a fresh Shrike message.',
    '<b>Add another wallet</b> to prove a different address.',
  ].join('\n')
}

export function restoreResultText({ granted, address, lines, roleNote, inviteLink }) {
  const title = granted
    ? 'Access restored — DATUM Gateway shares found'
    : 'Access not restored — no DATUM Gateway shares'
  const intro = granted
    ? `Checked the linked address <code>${escapeHtml(address)}</code> on the DATUM Gateway pools. At least one pool shows it still hashing through DATUM, so access was restored. Tap <b>Open DATUM Gateway</b> to go to the community with sending unlocked.`
    : `Checked the linked address <code>${escapeHtml(address)}</code> on the DATUM Gateway pools. Access was not restored.`
  const parts = [`<b>${title}</b>`, '', intro]
  if (roleNote) parts.push('', escapeHtml(roleNote))
  if (inviteLink && inviteLink.startsWith('https://')) {
    parts.push('', `<a href="${escapeHtml(inviteLink)}">Open the one-time invite</a>`)
  }
  if (lines?.length) {
    parts.push('', ...lines.map((line) => escapeHtml(line)))
  }
  return parts.join('\n')
}

export function ownershipConfirmedText(info) {
  return [
    '<b>Step 2 of 2 — DATUM Gateway shares</b>',
    '',
    `The signature matches <code>${escapeHtml(info.canonical)}</code>. You own this address.`,
    '',
    'Next, the bot checks whether that address is submitting shares through a DATUM Gateway. It looks at CONVOY, OmegaPool, RIPTide, Lazarus Pool, Blockvase, Paperclip Pool, and B2Pool.',
    '',
    'Tap the button when you want that check. Public stratum shares do not count.',
  ].join('\n')
}

export function scanResultText({ granted, lines, roleNote, inviteLink }) {
  const title = granted
    ? 'Verified — community access granted'
    : 'Address confirmed — no DATUM shares yet'
  const intro = granted
    ? 'You proved ownership, and at least one pool shows this address submitting shares through DATUM Gateway. Tap <b>Open DATUM Gateway</b> to go to the community. Sending is unlocked.'
    : 'None of the pools that answered show fresh DATUM Gateway shares, so sending stays locked. You can still read the chat.'
  const parts = [`<b>${title}</b>`, '', intro]
  if (roleNote) parts.push('', escapeHtml(roleNote))
  if (inviteLink && inviteLink.startsWith('https://')) {
    parts.push('', `<a href="${escapeHtml(inviteLink)}">Open the one-time invite</a>`)
  }
  if (lines?.length) {
    parts.push('', ...lines.map((line) => escapeHtml(line)))
  }
  return parts.join('\n')
}

export function statusText(miner) {
  let scan = null
  if (miner.lastScanJson) {
    try { scan = JSON.parse(miner.lastScanJson) } catch { scan = null }
  }
  const lines = [
    '<b>DATUM verification</b>',
    '',
    `Address: <code>${escapeHtml(miner.address)}</code> (${escapeHtml(miner.addressType)})`,
    `Access: ${miner.roleGranted ? 'granted' : 'not granted'}`,
    `Linked: ${new Date(miner.verifiedAt).toISOString()}`,
  ]
  if (miner.lastScanAt) lines.push(`Last scan: ${new Date(miner.lastScanAt).toISOString()}`)
  if (scan?.results) {
    lines.push('')
    for (const result of scan.results) {
      const mark = !result.ok ? 'unreachable' : result.activeDatum ? 'DATUM shares' : 'no DATUM shares'
      lines.push(`<b>${escapeHtml(result.name)}</b> — ${mark}. ${escapeHtml(result.detail)}`)
    }
  }
  return lines.join('\n')
}

export function removedText(address) {
  return `Sending is locked again. <code>${escapeHtml(address)}</code> did not have a fresh DATUM Gateway share on any pool that answered. You can still read the chat. Tap <b>Verify</b> for a new private form after shares are flowing.`
}
