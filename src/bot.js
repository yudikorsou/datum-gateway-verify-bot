import { onCancel, onChatId, onDatumCheck, onJoinRequest, onPrivateTextMessage, onStart, onStatus, onUnlink } from './flow.js'

export function registerBot(bot, { db, config }) {
  const deps = { db, config, api: bot.api }
  bot.command('start', (ctx) => onStart(ctx, deps))
  bot.command('verify', (ctx) => onStart(ctx, deps))
  bot.command('cancel', (ctx) => onCancel(ctx, deps))
  bot.command('status', (ctx) => onStatus(ctx, deps))
  bot.command('unlink', (ctx) => onUnlink(ctx, deps))
  bot.command('chatid', (ctx) => onChatId(ctx))
  bot.callbackQuery('verify:datum', (ctx) => onDatumCheck(ctx, deps))
  bot.on('message:text', (ctx) => onPrivateTextMessage(ctx, deps))
  bot.on('chat_join_request', (ctx) => onJoinRequest(ctx, deps))
}
