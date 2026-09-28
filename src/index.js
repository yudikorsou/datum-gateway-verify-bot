import { Bot } from 'grammy'
import { registerBot } from './bot.js'
import { readConfig } from './config.js'
import { openDatabase } from './db.js'
import { rescanMiners } from './rescan.js'

const config = readConfig()
const db = openDatabase(config.databasePath)
const bot = new Bot(config.token)

let scanning = false
async function scanTick(reason) {
  if (scanning) {
    console.log(`skipping ${reason} scan; previous scan still running`)
    return
  }
  scanning = true
  try {
    await rescanMiners(bot.api, db, config)
  } catch (error) {
    console.error(`${reason} scan failed`, error)
  } finally {
    scanning = false
  }
}

registerBot(bot, { db, config })

bot.catch((error) => {
  console.error('telegram update failed', error)
})

const intervalMs = config.scanIntervalHours * 60 * 60 * 1000
bot.start({
  allowed_updates: ['message', 'callback_query', 'chat_join_request'],
  onStart: (me) => {
    console.log(`logged in as @${me.username}`)
    setTimeout(() => scanTick('startup'), 30_000)
    setInterval(() => scanTick('scheduled'), intervalMs)
  },
})
