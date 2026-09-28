export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function askAddressText() {
  return [
    '<b>DATUM Gateway verification</b>',
    '',
    'Two checks, in order:',
    '1. Prove this Telegram account owns a public Bitcoin address.',
    '2. Show that address is submitting shares through a DATUM Gateway.',
    '',
    'Send the payout address. Shrike and other BTCB2 wallets use the same mainnet formats as Bitcoin: <code>1…</code>, <code>3…</code>, <code>bc1q…</code>, or <code>bc1p…</code>. Do not include a <code>.worker</code> suffix.',
  ].join('\n')
}

export function challengeText(info, message) {
  return [
    '<b>Step 1 of 2 — prove you own this address</b>',
    '',
    `Address: <code>${escapeHtml(info.canonical)}</code>`,
    `Type: ${escapeHtml(info.label)}`,
    '',
    'Sign this exact text in a wallet that can spend the address, then paste the signature here:',
    `<pre>${escapeHtml(message)}</pre>`,
    '<b>Shrike</b> (this is the same screen Sparrow has): Tools → Sign/Verify Message. Paste the text, choose this address, sign, and send the signature back.',
    '<b>Bitcoin Core:</b> <code>signmessage "&lt;address&gt;" "&lt;message&gt;"</code>',
    '<b>Electrum:</b> Tools → Sign/Verify message.',
    '',
    'Shrike addresses are ordinary mainnet addresses, including ones that only exist for the BLAKE2b chain. This step is a message signature. Shrike’s <code>SIGHASH_UNIFIED</code> flag applies when you spend coins, not when you sign this proof.',
    'Taproot (<code>bc1p…</code>) needs a BIP322 signature. Legacy and SegWit can use the classic Bitcoin signed message. A full signed-message block is accepted as well as the raw base64 signature.',
    '',
    'The message expires in 30 minutes.',
  ].join('\n')
}

export function datumKeyboard() {
  return {
    inline_keyboard: [[{ text: 'Check DATUM shares', callback_data: 'verify:datum' }]],
  }
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
    ? 'You proved ownership, and at least one pool shows this address submitting shares through DATUM Gateway.'
    : 'None of the pools that answered show fresh DATUM Gateway shares, so the community was not opened.'
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
  return `Community access was removed. <code>${escapeHtml(address)}</code> did not have a fresh DATUM Gateway share on any pool that answered. Send /verify again after shares are flowing.`
}

export function privateOnlyText() {
  return 'Open a private chat with this bot and send /verify. Do not post your signature in the community.'
}
