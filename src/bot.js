import {
  ActionRowBuilder,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js'
import { inspectAddress } from './address.js'
import { createChallenge } from './challenge.js'
import {
  addressOwner,
  deleteChallenge,
  deleteMiner,
  getChallenge,
  getMiner,
  listMiners,
  recordScan,
  saveChallenge,
  saveMiner,
} from './db.js'
import { challengeContent, challengeEmbed, optionsRow, restoreResultEmbed, resultEmbed, signatureRow, startRow, statusEmbed } from './present.js'
import { loadSharedSnapshots, scanAddress, summarizeScan } from './pools/scan.js'
import { grantRole, isUnknownMember, memberRoleState, revokeRole, roleErrorText } from './roles.js'
import { explainerFiles } from './explainer.js'
import { verifyOwnership } from './signature.js'
import { linkedAddress, restoreDecision, verifyEntry } from './verify-step.js'

const EPHEMERAL = { flags: MessageFlags.Ephemeral }

const VIEW_CHANNEL = 1n << 10n
const SEND_MESSAGES = 1n << 11n
const EMBED_LINKS = 1n << 14n
const READ_MESSAGE_HISTORY = 1n << 16n
const MANAGE_ROLES = 1n << 28n
const USE_APPLICATION_COMMANDS = 1n << 31n

export const BOT_INVITE_PERMISSIONS = String(
  VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | READ_MESSAGE_HISTORY | MANAGE_ROLES | USE_APPLICATION_COMMANDS,
)

export function botInviteUrl(clientId) {
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: BOT_INVITE_PERMISSIONS,
    integration_type: '0',
    scope: 'bot applications.commands',
  })
  return `https://discord.com/oauth2/authorize?${params.toString()}`
}

function slashCommands() {
  return [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Prove you own a Bitcoin address that is mining through DATUM Gateway')
      .addStringOption((option) => option
        .setName('address')
        .setDescription('Public payout address (1…, 3…, bc1q…, or bc1p…)')
        .setRequired(false)),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Show your linked address and the latest pool scan'),
    new SlashCommandBuilder()
      .setName('unlink')
      .setDescription('Remove your verification and the miner role'),
  ]
}

export function commandBuilders() {
  return slashCommands().map((command) => command.toJSON())
}

export async function registerCommands(config) {
  const rest = new REST({ version: '10' }).setToken(config.token)
  const guildBody = commandBuilders()
  const globalBody = guildBody.map((command) => ({
    ...command,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  }))
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: guildBody },
  )
  await rest.put(Routes.applicationCommands(config.clientId), { body: globalBody })
}

function roleHas(role, bit) {
  return (BigInt(role.permissions) & bit) === bit
}

const LOCKED_CHANNEL_OVERWRITES = new Set(['gateway', 'mods'])

export function shouldSkipChannelOverwrite(channel) {
  if (channel.type !== 0 && channel.type !== 5) return true
  return LOCKED_CHANNEL_OVERWRITES.has(String(channel.name || '').toLowerCase())
}

function overwriteErrorText(error) {
  return error?.rawError?.message || error?.message || String(error)
}

export async function ensureGuildPermissions(config) {
  const rest = new REST({ version: '10' }).setToken(config.token)
  const roles = await rest.get(Routes.guildRoles(config.guildId))
  const member = await rest.get(Routes.guildMember(config.guildId, config.clientId))
  const everyone = roles.find((role) => role.id === config.guildId)
  const botRoles = roles.filter((role) => member.roles.includes(role.id))
  const highestBotRole = botRoles.reduce((best, role) => {
    if (!best || role.position > best.position) return role
    return best
  }, null)
  const capableRole = botRoles.find((role) => roleHas(role, SEND_MESSAGES) && roleHas(role, USE_APPLICATION_COMMANDS))
  if (highestBotRole && capableRole && highestBotRole.id !== capableRole.id) {
    console.error(
      `Move the "${capableRole.name}" role above "${highestBotRole.name}" in Server Settings → Roles, then restart. The higher role needs Send Messages so it can grant the miner role.`,
    )
  }
  const everyonePerms = BigInt(everyone.permissions)
  if (!(everyonePerms & USE_APPLICATION_COMMANDS) && highestBotRole && roleHas(highestBotRole, USE_APPLICATION_COMMANDS)) {
    await rest.patch(Routes.guildRole(config.guildId, everyone.id), {
      body: { permissions: String(everyonePerms | USE_APPLICATION_COMMANDS) },
    })
    console.log('enabled Use Application Commands for @everyone')
  }
  const overwriteRole = capableRole || highestBotRole
  if (!overwriteRole) return
  const channels = await rest.get(Routes.guildChannels(config.guildId))
  const allow = String(VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | READ_MESSAGE_HISTORY | USE_APPLICATION_COMMANDS)
  for (const channel of channels) {
    if (shouldSkipChannelOverwrite(channel)) continue
    try {
      await rest.put(`/channels/${channel.id}/permissions/${overwriteRole.id}`, {
        body: { type: 0, allow, deny: '0' },
      })
    } catch (error) {
      console.error(`could not update #${channel.name} permissions: ${overwriteErrorText(error)}`)
    }
  }
  console.log('locked channels such as #gateway keep their overwrites; /verify stays ephemeral there')
}

function inAllowedPlace(interaction, config) {
  return !interaction.guildId || interaction.guildId === config.guildId
}

async function respondPrivately(interaction, payload) {
  const data = typeof payload === 'string' ? { content: payload } : payload
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(data)
      return
    }
    await interaction.reply({ ...data, ...EPHEMERAL })
  } catch (error) {
    console.error('channel reply failed; sending DM', error)
    try {
      await interaction.user.send({
        content: data.content,
        embeds: data.embeds,
        components: data.components,
        files: data.files,
      })
      const ack = { content: 'I sent the next step in your DMs.', ...EPHEMERAL }
      if (interaction.deferred || interaction.replied) await interaction.followUp(ack).catch(() => {})
      else await interaction.reply(ack).catch(() => {})
    } catch (dmError) {
      console.error('DM failed', dmError)
    }
  }
}

function addressModal() {
  return new ModalBuilder()
    .setCustomId('verify:address-modal')
    .setTitle('Public Bitcoin address')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('address')
        .setLabel('Address you can sign for')
        .setPlaceholder('bc1q…, bc1p…, 1…, or 3…')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120),
    ))
}

function signatureModal() {
  return new ModalBuilder()
    .setCustomId('verify:signature-modal')
    .setTitle('Wallet signature')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('signature')
        .setLabel('Signature')
        .setPlaceholder('Base64 signature, or the full signed-message block')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000),
    ))
}

function actionRows({ signature = false } = {}) {
  const rows = []
  if (signature) rows.push(signatureRow())
  rows.push(optionsRow())
  return rows
}

function rememberAddress(db, config, discordId, info) {
  const owner = addressOwner(db, info.canonical)
  if (owner && owner.discordId !== discordId) {
    return { error: 'That address is already linked to another Discord user.' }
  }
  const existing = getChallenge(db, discordId)
  if (existing?.address === info.canonical && existing.expiresAt > Date.now()) {
    return { info, message: existing.message }
  }
  return beginChallenge(db, config, discordId, info)
}

async function replyWithMenu(interaction, db, config, info, extra = '') {
  const miner = getMiner(db, interaction.user.id)
  const remembered = rememberAddress(db, config, interaction.user.id, info)
  if (remembered.error) {
    await respondPrivately(interaction, remembered.error)
    return
  }
  await respondPrivately(interaction, {
    content: [
      extra,
      `Linked wallet: \`${info.canonical}\`. You already proved this address, so you do not need a new signature.`,
      '**Restore role** checks whether this linked address is still hashing through a DATUM Gateway pool. The role is restored only if a pool still shows DATUM shares.',
      '**Sign again** only if you want a fresh Shrike message.',
      '**Add another wallet** to prove a different address.',
    ].filter(Boolean).join('\n'),
    embeds: miner ? [statusEmbed(miner)] : [],
    components: actionRows(),
  })
}

function challengeReply(info, message, extra) {
  return {
    content: challengeContent(message, extra),
    embeds: [challengeEmbed(info)],
    components: actionRows({ signature: true }),
    files: explainerFiles(),
  }
}

async function sendSignatureHelp(interaction, db) {
  const challenge = getChallenge(db, interaction.user.id)
  const info = challenge ? inspectAddress(challenge.address) : null
  const payload = {
    content: challenge
      ? challengeContent(
        challenge.message,
        'The sign popup is open. Watch the video, then paste the signature in the popup. An older signature will not match.',
      )
      : 'Watch the video, then paste your signature in the popup.',
    embeds: info?.ok ? [challengeEmbed(info)] : [],
    files: explainerFiles(),
  }
  try {
    await interaction.user.send(payload)
  } catch (error) {
    console.error('signature help DM failed', error)
  }
}

function beginChallenge(db, config, discordId, info) {
  const owner = addressOwner(db, info.canonical)
  if (owner && owner.discordId !== discordId) {
    return { error: 'That address is already linked to another Discord user.' }
  }
  const challenge = createChallenge({ discordId, address: info.canonical })
  saveChallenge(db, {
    discordId,
    address: info.canonical,
    message: challenge.message,
    nonce: challenge.nonce,
    expiresAt: Date.now() + config.challengeMinutes * 60 * 1000,
  })
  return { info, message: challenge.message }
}

export function createInteractionHandler({ client, db, config }) {
  return async function onInteraction(interaction) {
    try {
      if (!inAllowedPlace(interaction, config)) {
        if (interaction.isRepliable()) {
          await respondPrivately(interaction, 'Verification only runs in the configured server, or in a DM with this bot.')
        }
        return
      }
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'verify') await onVerify(interaction, client, db, config)
        else if (interaction.commandName === 'status') await onStatus(interaction, db)
        else if (interaction.commandName === 'unlink') await onUnlink(interaction, client, db, config)
        return
      }
      if (interaction.isButton()) {
        if (interaction.customId === 'verify:open-address') await interaction.showModal(addressModal())
        else if (interaction.customId === 'verify:open-signature') {
          await interaction.showModal(signatureModal())
          await sendSignatureHelp(interaction, db)
        }
        else if (interaction.customId === 'verify:sign-again') await onSignAgain(interaction, db, config)
        else if (interaction.customId === 'verify:restore') await onRestore(interaction, client, db, config)
        return
      }
      if (interaction.isModalSubmit()) {
        if (interaction.customId === 'verify:address-modal') await onAddressModal(interaction, client, db, config)
        else if (interaction.customId === 'verify:signature-modal') await onSignatureModal(interaction, client, db, config)
      }
    } catch (error) {
      console.error('interaction failed', error)
      const payload = { content: 'Something went wrong while handling that. Try `/verify` again.', ...EPHEMERAL }
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {})
      else if (interaction.isRepliable()) await interaction.reply(payload).catch(() => {})
    }
  }
}

async function replyWithChallenge(interaction, db, config, info) {
  const started = beginChallenge(db, config, interaction.user.id, info)
  if (started.error) {
    await respondPrivately(interaction, started.error)
    return
  }
  const miner = getMiner(db, interaction.user.id)
  const switching = miner && miner.address !== info.canonical
  await respondPrivately(interaction, challengeReply(
    started.info,
    started.message,
    switching
      ? `This will replace \`${miner.address}\` after you sign. An older signature will not match. Use **Sign again** to stay on the linked wallet, or **Restore role** for that wallet.`
      : 'Sign this new message in Shrike. An older signature will not match. If you already proved this address, use **Restore role** instead of Submit signature.',
  ))
}

async function continueAfterAddress(interaction, client, db, config, info) {
  const miner = getMiner(db, interaction.user.id)
  const membership = await memberRoleState(client, config, interaction.user.id)
  const step = verifyEntry({
    miner,
    challenge: getChallenge(db, interaction.user.id),
    hasRole: membership.hasRole,
    suppliedAddress: info.canonical,
  })
  if (step === 'menu') {
    await replyWithMenu(interaction, db, config, info)
    return
  }
  await replyWithChallenge(interaction, db, config, info)
}

async function onVerify(interaction, client, db, config) {
  const miner = getMiner(db, interaction.user.id)
  const challenge = getChallenge(db, interaction.user.id)
  const supplied = interaction.options.getString('address')
  if (supplied) {
    const info = inspectAddress(supplied)
    if (!info.ok) {
      await respondPrivately(interaction, info.error)
      return
    }
    await continueAfterAddress(interaction, client, db, config, info)
    return
  }
  const membership = await memberRoleState(client, config, interaction.user.id)
  const step = verifyEntry({ miner, challenge, hasRole: membership.hasRole })
  if (step === 'menu') {
    const address = linkedAddress(miner, challenge)
    const info = inspectAddress(address)
    if (!info.ok) {
      await interaction.showModal(addressModal())
      return
    }
    await replyWithMenu(interaction, db, config, info)
    return
  }
  if (step === 'resume-challenge') {
    const info = inspectAddress(challenge.address)
    await respondPrivately(interaction, challengeReply(
      info,
      challenge.message,
      'You already have a message to sign. An older signature will not match. If you already proved this address, use **Restore role** or **Sign again**.',
    ))
    return
  }
  await interaction.showModal(addressModal())
}

async function onAddressModal(interaction, client, db, config) {
  const info = inspectAddress(interaction.fields.getTextInputValue('address'))
  if (!info.ok) {
    await respondPrivately(interaction, info.error)
    return
  }
  await continueAfterAddress(interaction, client, db, config, info)
}

async function onSignAgain(interaction, db, config) {
  const address = linkedAddress(getMiner(db, interaction.user.id), getChallenge(db, interaction.user.id))
  if (!address) {
    await interaction.showModal(addressModal())
    return
  }
  const info = inspectAddress(address)
  if (!info.ok) {
    await respondPrivately(interaction, info.error)
    return
  }
  await replyWithChallenge(interaction, db, config, info)
}

async function onRestore(interaction, client, db, config) {
  await interaction.deferReply(EPHEMERAL)
  const miner = getMiner(db, interaction.user.id)
  if (!miner) {
    await interaction.editReply({
      content: 'No address is coupled to your Discord account yet. Use **Sign again** or **Add another wallet** first. Restore role only checks the linked address for DATUM Gateway shares.',
      components: actionRows(),
    })
    return
  }
  const address = miner.address
  const owner = addressOwner(db, address)
  if (owner && owner.discordId !== interaction.user.id) {
    await interaction.editReply({
      content: 'That address is already linked to another Discord user.',
      components: actionRows(),
    })
    return
  }
  const scan = await scanAddress(address, config)
  const lines = summarizeScan(scan)
  const decision = restoreDecision(scan)
  if (decision !== 'grant') {
    if (decision === 'deny') {
      try {
        await revokeRole(client, config, interaction.user.id)
      } catch (error) {
        if (!isUnknownMember(error)) {
          await interaction.editReply(roleErrorText(error))
          return
        }
      }
      recordScan(db, interaction.user.id, { roleGranted: false, scannedAt: Date.now(), scan })
    }
    await interaction.editReply({
      embeds: [restoreResultEmbed({
        granted: false,
        address,
        lines,
        roleNote: decision === 'deny'
          ? 'Every pool answered. This linked address is not hashing through a DATUM Gateway, so the role was not restored.'
          : 'A pool did not answer, so this check is not treated as a no. The role was not changed. Try again when that pool is reachable.',
      })],
      components: actionRows(),
    })
    return
  }
  try {
    await grantRole(client, config, interaction.user.id)
  } catch (error) {
    if (isUnknownMember(error)) {
      recordScan(db, interaction.user.id, { roleGranted: false, scannedAt: Date.now(), scan })
      await interaction.editReply({
        content: 'You are not in this server. Rejoin, then run `/verify`.',
        components: actionRows(),
      })
      return
    }
    await interaction.editReply({ content: roleErrorText(error), components: actionRows() })
    return
  }
  recordScan(db, interaction.user.id, { roleGranted: true, scannedAt: Date.now(), scan })
  await interaction.editReply({
    embeds: [restoreResultEmbed({
      granted: true,
      address,
      lines,
      roleNote: 'The role is restored only while this linked address keeps hashing through DATUM Gateway.',
    })],
    components: actionRows(),
  })
}

async function onSignatureModal(interaction, client, db, config) {
  await interaction.deferReply(EPHEMERAL)
  const challenge = getChallenge(db, interaction.user.id)
  if (!challenge) {
    await interaction.editReply({
      content: 'Start with `/verify` and sign the message the bot gives you.',
      components: actionRows(),
    })
    return
  }
  if (challenge.expiresAt < Date.now()) {
    deleteChallenge(db, interaction.user.id)
    await interaction.editReply({
      content: 'That challenge expired. Sign again or add another wallet so the signed message is fresh.',
      components: actionRows(),
    })
    return
  }
  const signature = interaction.fields.getTextInputValue('signature')
  const proof = verifyOwnership(challenge.address, challenge.message, signature)
  if (!proof.ok) {
    await interaction.editReply({
      embeds: [resultEmbed({ granted: false, owned: false, lines: [proof.reason] })],
      components: actionRows({ signature: true }),
    })
    return
  }

  const scan = await scanAddress(challenge.address, config)
  const lines = summarizeScan(scan)
  if (!scan.activeDatum) {
    await interaction.editReply({
      embeds: [resultEmbed({
        granted: false,
        owned: true,
        lines,
        roleNote: scan.conclusive
          ? 'Every pool answered. None show fresh DATUM shares for this address.'
          : 'A pool that did not answer is not counted as a no. Check again when it is reachable, or mine through a pool that labels DATUM shares.',
      })],
      components: actionRows(),
    })
    return
  }

  let roleGranted = false
  let roleNote = null
  try {
    await grantRole(client, config, interaction.user.id)
    roleGranted = true
  } catch (error) {
    if (isUnknownMember(error)) {
      deleteChallenge(db, interaction.user.id)
      await interaction.editReply({
        content: 'You are not in this server, so the role cannot be assigned. Rejoin, then run `/verify`.',
        components: actionRows(),
      })
      return
    }
    roleNote = roleErrorText(error)
  }
  const info = inspectAddress(challenge.address)
  saveMiner(db, {
    discordId: interaction.user.id,
    address: challenge.address,
    addressType: info.type,
    signature,
    verifiedAt: Date.now(),
    roleGranted,
    lastScanAt: Date.now(),
    lastScanJson: JSON.stringify(scan),
  })
  deleteChallenge(db, interaction.user.id)
  await interaction.editReply({
    embeds: [resultEmbed({ granted: roleGranted, owned: true, lines, roleNote })],
    components: actionRows(),
  })
}

async function onStatus(interaction, db) {
  const miner = getMiner(db, interaction.user.id)
  if (!miner) {
    await respondPrivately(interaction, {
      content: 'You are not verified yet. Use `/verify`, or **Add another wallet** to start.',
      components: actionRows(),
    })
    return
  }
  await respondPrivately(interaction, {
    embeds: [statusEmbed(miner)],
    components: actionRows(),
  })
}

async function onUnlink(interaction, client, db, config) {
  const miner = getMiner(db, interaction.user.id)
  if (!miner) {
    await interaction.reply({ content: 'You do not have a linked address.', ...EPHEMERAL })
    return
  }
  await interaction.deferReply(EPHEMERAL)
  try {
    await revokeRole(client, config, interaction.user.id)
  } catch (error) {
    await interaction.editReply(roleErrorText(error))
    return
  }
  deleteMiner(db, interaction.user.id)
  deleteChallenge(db, interaction.user.id)
  await interaction.editReply({
    content: `Unlinked \`${miner.address}\` and removed the role. Enter a new address when you want to verify again.`,
    components: [startRow()],
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function rescanMiners(client, db, config) {
  const miners = listMiners(db)
  if (!miners.length) {
    console.log('daily scan: no linked miners')
    return
  }
  const shared = await loadSharedSnapshots()
  for (const miner of miners) {
    try {
      const scan = await scanAddress(miner.address, config, shared)
      const scannedAt = Date.now()
      if (scan.activeDatum) {
        try {
          await grantRole(client, config, miner.discordId)
          recordScan(db, miner.discordId, { roleGranted: true, scannedAt, scan })
          console.log(`daily scan: kept ${miner.discordId}`)
        } catch (error) {
          if (isUnknownMember(error)) {
            recordScan(db, miner.discordId, { roleGranted: false, scannedAt, scan })
            console.log(`daily scan: ${miner.discordId} is not in the server; /verify will issue a new message after they rejoin`)
          } else {
            console.error(`daily scan: role grant failed for ${miner.discordId}`, error.message)
            recordScan(db, miner.discordId, { roleGranted: Boolean(miner.roleGranted), scannedAt, scan })
          }
        }
      } else if (!scan.conclusive) {
        recordScan(db, miner.discordId, { roleGranted: Boolean(miner.roleGranted), scannedAt, scan })
        console.log(`daily scan: skipped ${miner.discordId} because a pool did not answer`)
      } else {
        await revokeRole(client, config, miner.discordId)
        recordScan(db, miner.discordId, { roleGranted: false, scannedAt, scan })
        console.log(`daily scan: removed role from ${miner.discordId}`)
        try {
          const user = await client.users.fetch(miner.discordId)
          await user.send(`The DATUM miner role was removed. \`${miner.address}\` did not have a fresh DATUM Gateway share on any pool that answered. Run \`/verify\` again after shares are flowing.`)
        } catch (error) {
          console.error(`daily scan: could not DM ${miner.discordId}`, error.message)
        }
      }
    } catch (error) {
      console.error(`daily scan failed for ${miner.discordId}`, error)
    }
    await sleep(400)
  }
}
