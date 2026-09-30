import { Bot } from 'grammy'
import { applyReadOnlyDefaults, grantAccessInCommunities, inspectAllCommunities } from './access.js'
import { registerBot } from './bot.js'
import { configuredChatIds, readConfig } from './config.js'
import { listMiners, openDatabase } from './db.js'
import { rescanMiners } from './rescan.js'
import { applyUmbrelSettings } from './umbrel.js'

await applyUmbrelSettings({ platform: 'telegram' })

const COMMANDS = [
  { command: 'start', description: 'Start DATUM Gateway verification' },
  { command: 'verify', description: 'Prove a Bitcoin address and DATUM Gateway shares' },
  { command: 'status', description: 'Show your linked address and last scan' },
  { command: 'unlink', description: 'Unlink your address and leave the community' },
  { command: 'cancel', description: 'Cancel an unfinished proof' },
  { command: 'chatid', description: 'Show this chat id for the communities list' },
]

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
  allowed_updates: ['message', 'callback_query', 'chat_join_request', 'chat_member'],
  onStart: async (me) => {
    console.log(`logged in as @${me.username}`)
    if (config.webAppUrl) console.log(`paste fields: ${config.webAppUrl}`)
    try {
      await bot.api.setMyCommands(COMMANDS)
      console.log('commands registered')
    } catch (error) {
      console.error('could not register commands', error)
    }
    try {
      await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } })
      console.log('menu uses commands so Mini App submit can send')
    } catch (error) {
      console.error('could not set chat menu button', error?.description || error?.message)
    }
    const chatIds = configuredChatIds(config)
    if (!chatIds.length) {
      console.log('No Telegram communities configured. Add this bot to each community, send /chatid there, save those ids, and restart.')
      return
    }
    try {
      for (const access of await inspectAllCommunities(bot.api, config)) {
        if (access.warning) console.error(`community ${access.chatId || '?'} blocked: ${access.warning}`)
        else console.log(`community ready: ${access.title} (${access.chatId})`)
      }
    } catch (error) {
      console.error('could not inspect community access', error)
    }
    try {
      await applyReadOnlyDefaults(bot.api, config)
      console.log(`locked ${chatIds.length} community chat(s) until DATUM verification`)
      for (const miner of listMiners(db)) {
        if (!miner.roleGranted) continue
        try {
          await grantAccessInCommunities(bot.api, config, miner.telegramId, { inviteIfAbsent: false })
        } catch (error) {
          console.error(`could not restore sending for ${miner.telegramId}`, error?.description || error?.message)
        }
      }
    } catch (error) {
      console.error('could not lock default chat permissions', error)
    }
    setTimeout(() => scanTick('startup'), 30_000)
    setInterval(() => scanTick('scheduled'), intervalMs)
  },
})
