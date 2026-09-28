import assert from 'node:assert/strict'
import test from 'node:test'
import { accessErrorText, grantAccess, revokeAccess } from '../src/access.js'

const config = { chatId: '-100123' }

function missingRequest() {
  return Object.assign(new Error('Bad Request: HIDE_REQUESTER_MISSING'), { error_code: 400 })
}

test('approves a pending join request', async () => {
  const calls = []
  const api = {
    getChatMember: async () => ({ status: 'left' }),
    approveChatJoinRequest: async (...args) => { calls.push(args); return true },
    createChatInviteLink: async () => { throw new Error('invite should not be created') },
  }
  const result = await grantAccess(api, config, '42')
  assert.equal(result.granted, true)
  assert.equal(result.inviteLink, null)
  assert.deepEqual(calls, [['-100123', 42]])
})

test('issues a one-time invite when nobody is waiting to join', async () => {
  const api = {
    getChatMember: async () => ({ status: 'left' }),
    approveChatJoinRequest: async () => { throw missingRequest() },
    createChatInviteLink: async (_chat, options) => {
      assert.equal(options.member_limit, 1)
      assert.equal(options.creates_join_request, false)
      return { invite_link: 'https://t.me/+once' }
    },
  }
  const result = await grantAccess(api, config, '42')
  assert.equal(result.inviteLink, 'https://t.me/+once')
})

test('does not mint an invite during a rescan of someone who already had access', async () => {
  let invited = false
  const api = {
    getChatMember: async () => ({ status: 'left' }),
    approveChatJoinRequest: async () => { throw missingRequest() },
    createChatInviteLink: async () => { invited = true },
  }
  const result = await grantAccess(api, config, '42', { inviteIfAbsent: false })
  assert.equal(result.absent, true)
  assert.equal(result.granted, false)
  assert.equal(invited, false)
})

test('lifts restrictions for a muted member', async () => {
  let permissions = null
  const api = {
    getChatMember: async () => ({ status: 'restricted' }),
    restrictChatMember: async (_chat, _user, next) => { permissions = next },
  }
  const result = await grantAccess(api, config, '42')
  assert.equal(result.granted, true)
  assert.equal(permissions.can_send_messages, true)
})

test('kicks a member by banning and then allowing them to return', async () => {
  const calls = []
  const api = {
    getChatMember: async () => ({ status: 'member' }),
    banChatMember: async (...args) => { calls.push(['ban', ...args]) },
    unbanChatMember: async (...args) => { calls.push(['unban', ...args]) },
  }
  await revokeAccess(api, config, '42')
  assert.equal(calls[0][0], 'ban')
  assert.equal(calls[1][0], 'unban')
})

test('refuses to kick an admin', async () => {
  const api = { getChatMember: async () => ({ status: 'administrator' }) }
  await assert.rejects(() => revokeAccess(api, config, '42'), /admin/)
})

test('describes a missing admin right', () => {
  const text = accessErrorText({ error_code: 403, description: 'Forbidden: not enough rights' })
  assert.match(text, /Ban Users/)
})
