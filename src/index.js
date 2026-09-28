import { Client, GatewayIntentBits } from 'discord.js'
import { createInteractionHandler, registerCommands, rescanMiners } from './bot.js'
import { readConfig } from './config.js'
import { openDatabase } from './db.js'

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

client.once('clientReady', async () => {
  console.log(`logged in as ${client.user.tag}`)
  try {
    await registerCommands(config)
    console.log(`commands registered in guild ${config.guildId}`)
  } catch (error) {
    console.error('command registration failed', error)
  }
  const intervalMs = config.scanIntervalHours * 60 * 60 * 1000
  setTimeout(() => scanTick('startup'), 30_000)
  setInterval(() => scanTick('scheduled'), intervalMs)
})

client.on('interactionCreate', createInteractionHandler({ client, db, config }))

await client.login(config.token)
