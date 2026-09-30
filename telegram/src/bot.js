import {
  onAddWallet,
  onCancel,
  onChatId,
  onChatMember,
  onDatumCheck,
  onJoinRequest,
  onRestore,
  onSignAgain,
  onStart,
  onStatus,
  onTextMessage,
  onUnlink,
  onWebAppData,
} from './flow.js'

export function registerBot(bot, { db, config }) {
  const deps = { db, config, api: bot.api }
  bot.command('start', (ctx) => onStart(ctx, deps))
  bot.command('verify', (ctx) => onStart(ctx, deps))
  bot.command('cancel', (ctx) => onCancel(ctx, deps))
  bot.command('status', (ctx) => onStatus(ctx, deps))
  bot.command('unlink', (ctx) => onUnlink(ctx, deps))
  bot.command('chatid', (ctx) => onChatId(ctx))
  bot.callbackQuery('verify:start', (ctx) => onStart(ctx, deps))
  bot.callbackQuery('verify:datum', (ctx) => onDatumCheck(ctx, deps))
  bot.callbackQuery('verify:restore', (ctx) => onRestore(ctx, deps))
  bot.callbackQuery('verify:sign-again', (ctx) => onSignAgain(ctx, deps))
  bot.callbackQuery('verify:new-wallet', (ctx) => onAddWallet(ctx, deps))
  bot.on('message', async (ctx, next) => {
    if (ctx.message?.web_app_data) {
      await onWebAppData(ctx, deps)
      return
    }
    await next()
  })
  bot.on('message:text', (ctx) => onTextMessage(ctx, deps))
  bot.on('chat_join_request', (ctx) => onJoinRequest(ctx, deps))
  bot.on('chat_member', (ctx) => onChatMember(ctx, deps))
}
