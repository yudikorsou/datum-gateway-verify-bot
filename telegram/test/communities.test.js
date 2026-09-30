import assert from 'node:assert/strict'
import test from 'node:test'
import { communityConfig, configuredChatIds, normalizeChatIds } from '../src/config.js'
import { grantAccessInCommunities, revokeAccessInCommunities } from '../src/access.js'

test('legacy chat id becomes one community', () => {
  assert.deepEqual(normalizeChatIds({ TELEGRAM_CHAT_ID: '-1001' }), ['-1001'])
})

test('TELEGRAM_CHAT_IDS accepts JSON and comma lists', () => {
  assert.deepEqual(
    normalizeChatIds({ TELEGRAM_CHAT_IDS: '["-1002","-1003"]', TELEGRAM_CHAT_ID: '-1001' }),
    ['-1001', '-1002', '-1003'],
  )
  assert.deepEqual(
    normalizeChatIds({ TELEGRAM_CHAT_IDS: '-1008,-1009' }),
    ['-1008', '-1009'],
  )
})

test('communityConfig scopes a chat without mutating the original', () => {
  const config = { chatIds: ['-1001', '-1002'], chatId: '-1001', token: 'x' }
  const scoped = communityConfig(config, '-1002')
  assert.equal(scoped.chatId, '-1002')
  assert.equal(config.chatId, '-1001')
  assert.deepEqual(configuredChatIds(config), ['-1001', '-1002'])
})

test('grant and revoke walk every configured Telegram chat', async () => {
  const calls = []
  const api = {
    async getChatMember(chatId, userId) {
      calls.push(['member', chatId, userId])
      return { status: 'restricted' }
    },
    async restrictChatMember(chatId, userId) {
      calls.push(['restrict', chatId, userId])
    },
  }
  const config = { chatIds: ['-1001', '-1002'], chatId: '-1001' }
  const granted = await grantAccessInCommunities(api, config, '42', { inviteIfAbsent: false })
  assert.equal(granted.granted, true)
  await revokeAccessInCommunities(api, config, '42')
  assert.deepEqual(
    calls.filter((entry) => entry[0] === 'restrict').map((entry) => entry[1]),
    ['-1001', '-1002', '-1001', '-1002'],
  )
})
