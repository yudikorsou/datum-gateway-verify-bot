import { Client, GatewayIntentBits } from 'discord.js'
import { botInviteUrl, createInteractionHandler, ensureGuildPermissions, registerCommands, rescanMiners } from './bot.js'
import { readConfig } from './config.js'
import { openDatabase } from './db.js'
import { applyUmbrelSettings } from './umbrel.js'

await applyUmbrelSettings({ platform: 'discord' })
const config = readConfig()
const db = openDatabase(config.databasePath)
const client = new Client({ intents: [GatewayIntentBits.Guilds] })

let scanning = false
async function scanTick(reason) {
  if (scanning) {
    console.log(`skipping ${reason} scan; previous scan still running`)
    return
  }
  scanning = true
  try {
    await rescanMiners(client, db, config)
  } catch (error) {
    console.error(`${reason} scan failed`, error)
  } finally {
    scanning = false
  }
}

let booted = false
async function onReady() {
  if (booted) return
  booted = true
  console.log(`logged in as ${client.user.tag}`)
  try {
    await registerCommands(config)
    console.log(`commands registered in ${config.guilds.length} guild(s)`)
  } catch (error) {
    console.error('command registration failed', error)
  }
  try {
    await ensureGuildPermissions(config)
  } catch (error) {
    console.error('guild permission setup failed', error)
    console.error(`Re-invite the bot: ${botInviteUrl(config.clientId)}`)
  }
  const intervalMs = config.scanIntervalHours * 60 * 60 * 1000
  setTimeout(() => scanTick('startup'), 30_000)
  setInterval(() => scanTick('scheduled'), intervalMs)
}

client.once('clientReady', onReady)
client.once('ready', onReady)
client.on('error', (error) => console.error('discord client error', error))
client.on('warn', (message) => console.warn('discord warn', message))
client.on('interactionCreate', (interaction) => {
  console.log(`interaction ${interaction.type} ${interaction.commandName || interaction.customId || ''}`)
})
client.on('interactionCreate', createInteractionHandler({ client, db, config }))

await client.login(config.token)
