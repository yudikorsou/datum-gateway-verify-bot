import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js'

export function startRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:open-address')
      .setLabel('Enter your address')
      .setStyle(ButtonStyle.Primary),
  )
}

export function optionsRow({ restore = true, signAgain = true, newWallet = true } = {}) {
  const buttons = []
  if (restore) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('verify:restore')
        .setLabel('Restore role')
        .setStyle(ButtonStyle.Secondary),
    )
  }
  if (signAgain) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('verify:sign-again')
        .setLabel('Sign again')
        .setStyle(ButtonStyle.Secondary),
    )
  }
  if (newWallet) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('verify:open-address')
        .setLabel('Add another wallet')
        .setStyle(ButtonStyle.Primary),
    )
  }
  return new ActionRowBuilder().addComponents(...buttons)
}

export function restoreRow() {
  return optionsRow()
}

export function linkedRow() {
  return optionsRow()
}

export function signatureRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:open-signature')
      .setLabel('Submit signature')
      .setStyle(ButtonStyle.Primary),
  )
}

export function challengeContent(message, extra = '') {
  return [
    extra,
    'Copy this exact text into your wallet — tap the copy icon on the block, or long-press it. Discord will not let you copy text from the card below.',
    '```',
    message,
    '```',
  ].filter(Boolean).join('\n')
}

export function challengeEmbed(info) {
  return new EmbedBuilder()
    .setColor(0xe8a317)
    .setTitle('Step 1 of 2 — prove you own this address')
    .setDescription([
      `Address: \`${info.canonical}\``,
      `Type: ${info.label}`,
      '',
      'The sign text is in the copyable code block above this card. Watch the attached video, or the private copy the bot sends when you open **Submit signature**.',
      '',
      '**Shrike** (same screen as Sparrow): Tools → Sign/Verify Message. Paste the copied text, choose this address, and click **Sign**. **Verify** only checks a signature you already created. An older signature does not match this text. Then use **Submit signature**.',
      '**Bitcoin Core:** `signmessage "<address>" "<message>"`',
      '**Electrum:** Tools → Sign/Verify message.',
      '',
      'Shrike addresses are ordinary mainnet addresses (`1…`, `3…`, `bc1q…`, `bc1p…`), including the ones pools pay on the BLAKE2b chain. This step is a message signature. Shrike’s `SIGHASH_UNIFIED` flag applies when you spend coins, not when you sign this proof.',
      'Taproot (`bc1p…`) needs a BIP322 signature. Legacy and SegWit can use the classic Bitcoin signed message.',
    ].join('\n'))
}

export function restoreResultEmbed({ granted, address, lines, roleNote }) {
  const title = granted
    ? 'Role restored — DATUM Gateway shares found'
    : 'Role not restored — no DATUM Gateway shares'
  const color = granted ? 0x3ddc97 : 0xe8a317
  const intro = granted
    ? `Checked the linked address \`${address}\` on the DATUM Gateway pools. At least one pool shows it still hashing through DATUM, so the role was restored.`
    : `Checked the linked address \`${address}\` on the DATUM Gateway pools. The role was not restored.`
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription([intro, roleNote, '', ...lines].filter(Boolean).join('\n'))
}

export function resultEmbed({ granted, owned, lines, roleNote }) {
  const title = granted
    ? 'Verified — role assigned'
    : owned
      ? 'Address confirmed — no DATUM shares yet'
      : 'Verification failed'
  const color = granted ? 0x3ddc97 : owned ? 0xe8a317 : 0xe85d4c
  const intro = granted
    ? 'You proved ownership, and at least one pool shows this address submitting shares through DATUM Gateway.'
    : owned
      ? 'The signature matches this address. None of the pools that answered show fresh DATUM Gateway shares, so the role was not assigned.'
      : 'The signature does not prove ownership, so pools were not checked.'
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription([intro, roleNote, '', ...lines].filter(Boolean).join('\n'))
}

export function statusEmbed(miner) {
  let scan = null
  if (miner.lastScanJson) {
    try { scan = JSON.parse(miner.lastScanJson) } catch { scan = null }
  }
  const lines = [
    `Address: \`${miner.address}\` (${miner.addressType})`,
    `Role: ${miner.roleGranted ? 'assigned' : 'not assigned'}`,
    `Linked: ${new Date(miner.verifiedAt).toISOString()}`,
  ]
  if (miner.lastScanAt) lines.push(`Last scan: ${new Date(miner.lastScanAt).toISOString()}`)
  if (scan?.results) {
    lines.push('')
    for (const result of scan.results) {
      const mark = !result.ok ? 'unreachable' : result.activeDatum ? 'DATUM shares' : 'no DATUM shares'
      lines.push(`**${result.name}** — ${mark}. ${result.detail}`)
    }
  }
  return new EmbedBuilder().setColor(0x7aa2f7).setTitle('DATUM verification').setDescription(lines.join('\n'))
}
