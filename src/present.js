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

export function signatureRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:open-signature')
      .setLabel('Submit signature')
      .setStyle(ButtonStyle.Primary),
  )
}

export function challengeEmbed(info, message) {
  return new EmbedBuilder()
    .setColor(0xe8a317)
    .setTitle('Step 1 of 2 — prove you own this address')
    .setDescription([
      `Address: \`${info.canonical}\``,
      `Type: ${info.label}`,
      '',
      'Sign this exact text in a wallet that can spend the address:',
      '```',
      message,
      '```',
      '**Shrike** (it inherits this from Sparrow): Tools → Sign/Verify Message. Paste the text, choose this address, sign, then use **Submit signature**.',
      '**Bitcoin Core:** `signmessage "<address>" "<message>"`',
      '**Electrum:** Tools → Sign/Verify message.',
      '',
      'Shrike addresses are ordinary mainnet addresses (`1…`, `3…`, `bc1q…`, `bc1p…`), including the ones pools pay on the BLAKE2b chain. This step is a message signature. Shrike’s `SIGHASH_UNIFIED` flag applies when you spend coins, not when you sign this proof.',
      'Taproot (`bc1p…`) needs a BIP322 signature. Legacy and SegWit can use the classic Bitcoin signed message.',
    ].join('\n'))
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
