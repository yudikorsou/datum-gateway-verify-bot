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
import { challengeEmbed, linkedRow, restoreRow, resultEmbed, signatureRow, startRow, statusEmbed } from './present.js'
import { loadSharedSnapshots, scanAddress, summarizeScan } from './pools/scan.js'
import { grantRole, isUnknownMember, memberRoleState, revokeRole, roleErrorText } from './roles.js'
import { verifyOwnership } from './signature.js'

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

export function commandBuilders() {
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
  ].map((command) => ({
    ...command.toJSON(),
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  }))
}

export async function registerCommands(config) {
  const rest = new REST({ version: '10' }).setToken(config.token)
  const body = commandBuilders()
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body },
  )
  await rest.put(Routes.applicationCommands(config.clientId), { body })
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
  const combined = botRoles.reduce((acc, role) => acc | BigInt(role.permissions), BigInt(everyone?.permissions || 0))
  if (!(combined & USE_APPLICATION_COMMANDS) || !(combined & SEND_MESSAGES)) {
    throw new Error(`Bot is missing Send Messages or Use Application Commands. Re-invite it: ${botInviteUrl(config.clientId)}`)
  }
  const everyonePerms = BigInt(everyone.permissions)
  if (!(everyonePerms & USE_APPLICATION_COMMANDS)) {
    await rest.patch(Routes.guildRole(config.guildId, everyone.id), {
      body: { permissions: String(everyonePerms | USE_APPLICATION_COMMANDS) },
    })
    console.log('enabled Use Application Commands for @everyone')
  }
  if (!highestBotRole) return
  const channels = await rest.get(Routes.guildChannels(config.guildId))
  const allow = String(VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | READ_MESSAGE_HISTORY | USE_APPLICATION_COMMANDS)
  for (const channel of channels) {
    if (channel.type !== 0 && channel.type !== 5) continue
    if (channel.name === 'mods') continue
    try {
      await rest.put(`/channels/${channel.id}/permissions/${highestBotRole.id}`, {
        body: { type: 0, allow, deny: '0' },
      })
    } catch (error) {
      console.error(`could not update #${channel.name} permissions`, error)
    }
  }
}

function inGuild(interaction, config) {
  return interaction.guildId === config.guildId
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
      if (!inGuild(interaction, config)) {
        if (interaction.isRepliable()) {
          await interaction.reply({ content: 'Verification only runs in the configured server.', ...EPHEMERAL })
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
        else if (interaction.customId === 'verify:open-signature') await interaction.showModal(signatureModal())
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
    await interaction.reply({ content: started.error, ...EPHEMERAL })
    return
  }
  const miner = getMiner(db, interaction.user.id)
  const sameWallet = miner?.address === info.canonical
  const switching = miner && !sameWallet
  await interaction.reply({
    content: sameWallet
      ? 'Sign this new message in Shrike. Restore role works only while this address is still submitting DATUM Gateway shares. To prove a different wallet, choose **Enter a new address**.'
      : switching
        ? `This will replace \`${miner.address}\` after you sign. Sign this new message in Shrike.`
        : 'Sign this new message in Shrike. A signature from an older message will not match.',
    embeds: [challengeEmbed(started.info, started.message)],
    components: sameWallet ? [signatureRow(), restoreRow()] : [signatureRow()],
    ...EPHEMERAL,
  })
}

async function rejectAddressChangeWhileVerified(interaction, client, db, config, info) {
  const miner = getMiner(db, interaction.user.id)
  if (!miner || miner.address === info.canonical) return false
  const membership = await memberRoleState(client, config, interaction.user.id)
  if (!membership.inServer || !membership.hasRole) return false
  await interaction.reply({
    content: `You still have the role for \`${miner.address}\`. Remove that role, wait until it is taken away, or use \`/unlink\` before proving a different wallet.`,
    ...EPHEMERAL,
  })
  return true
}

async function onVerify(interaction, client, db, config) {
  const supplied = interaction.options.getString('address')
  if (!supplied) {
    const miner = getMiner(db, interaction.user.id)
    if (miner) {
      const membership = await memberRoleState(client, config, interaction.user.id)
      if (!membership.inServer || !membership.hasRole) {
        const info = inspectAddress(miner.address)
        if (!info.ok) {
          await interaction.reply({ content: info.error, ...EPHEMERAL })
          return
        }
        await replyWithChallenge(interaction, db, config, info)
        return
      }
      await interaction.reply({
        content: `You already have the role for \`${miner.address}\`. Choose **Sign again** only if you want to prove the wallet with a new message.`,
        components: [linkedRow()],
        ...EPHEMERAL,
      })
      return
    }
    await interaction.reply({
      content: 'Verification has two steps: prove the address is yours, then the bot checks DATUM Gateway pools for fresh shares. Start with the address.',
      components: [startRow()],
      ...EPHEMERAL,
    })
    return
  }
  const info = inspectAddress(supplied)
  if (!info.ok) {
    await interaction.reply({ content: info.error, ...EPHEMERAL })
    return
  }
  if (await rejectAddressChangeWhileVerified(interaction, client, db, config, info)) return
  await replyWithChallenge(interaction, db, config, info)
}

async function onAddressModal(interaction, client, db, config) {
  const info = inspectAddress(interaction.fields.getTextInputValue('address'))
  if (!info.ok) {
    await interaction.reply({ content: info.error, ...EPHEMERAL })
    return
  }
  if (await rejectAddressChangeWhileVerified(interaction, client, db, config, info)) return
  await replyWithChallenge(interaction, db, config, info)
}

async function onSignAgain(interaction, db, config) {
  const miner = getMiner(db, interaction.user.id)
  if (!miner) {
    await interaction.showModal(addressModal())
    return
  }
  const info = inspectAddress(miner.address)
  if (!info.ok) {
    await interaction.reply({ content: info.error, ...EPHEMERAL })
    return
  }
  const started = beginChallenge(db, config, interaction.user.id, info)
  if (started.error) {
    await interaction.reply({ content: started.error, ...EPHEMERAL })
    return
  }
  await interaction.reply({
    embeds: [challengeEmbed(started.info, started.message)],
    components: [signatureRow()],
    ...EPHEMERAL,
  })
}

async function onRestore(interaction, client, db, config) {
  await interaction.deferReply(EPHEMERAL)
  const miner = getMiner(db, interaction.user.id)
  if (!miner) {
    await interaction.editReply('No wallet is linked yet. Choose **Sign again** and enter the address.')
    return
  }
  const scan = await scanAddress(miner.address, config)
  const lines = summarizeScan(scan)
  if (!scan.activeDatum) {
    if (scan.conclusive) {
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
      embeds: [resultEmbed({
        granted: false,
        owned: true,
        lines,
        roleNote: scan.conclusive
          ? 'Every pool answered. This address is not submitting DATUM Gateway shares, so the role was not restored.'
          : 'A pool did not answer, so the role was not restored. Try again when that pool is reachable.',
      })],
    })
    return
  }
  try {
    await grantRole(client, config, interaction.user.id)
  } catch (error) {
    if (isUnknownMember(error)) {
      recordScan(db, interaction.user.id, { roleGranted: false, scannedAt: Date.now(), scan })
      await interaction.editReply('You are not in this server. Rejoin, then run `/verify`. The bot will give you a new message to sign in Shrike.')
      return
    }
    await interaction.editReply(roleErrorText(error))
    return
  }
  recordScan(db, interaction.user.id, { roleGranted: true, scannedAt: Date.now(), scan })
  await interaction.editReply({
    embeds: [resultEmbed({ granted: true, owned: true, lines })],
  })
}

async function onSignatureModal(interaction, client, db, config) {
  await interaction.deferReply(EPHEMERAL)
  const challenge = getChallenge(db, interaction.user.id)
  if (!challenge) {
    await interaction.editReply('Start with `/verify` and sign the message the bot gives you.')
    return
  }
  if (challenge.expiresAt < Date.now()) {
    deleteChallenge(db, interaction.user.id)
    await interaction.editReply('That challenge expired. Run `/verify` again so the signed message is fresh.')
    return
  }
  const signature = interaction.fields.getTextInputValue('signature')
  const proof = verifyOwnership(challenge.address, challenge.message, signature)
  if (!proof.ok) {
    await interaction.editReply({ embeds: [resultEmbed({ granted: false, owned: false, lines: [proof.reason] })] })
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
      await interaction.editReply('You are not in this server, so the role cannot be assigned. Rejoin, run `/verify`, and sign a new message.')
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
  })
}

async function onStatus(interaction, db) {
  const miner = getMiner(db, interaction.user.id)
  if (!miner) {
    await interaction.reply({ content: 'You are not verified yet. Use `/verify`.', ...EPHEMERAL })
    return
  }
  await interaction.reply({ embeds: [statusEmbed(miner)], ...EPHEMERAL })
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
  await interaction.editReply(`Unlinked \`${miner.address}\` and removed the role.`)
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
