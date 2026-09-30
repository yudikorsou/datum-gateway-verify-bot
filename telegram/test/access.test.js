import assert from 'node:assert/strict'
import test from 'node:test'
import { accessErrorText, botAccessWarning, describeBotAccess, grantAccess, revokeAccess } from '../src/access.js'

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

test('unlocks sending for a regular member in a read-only chat', async () => {
  let permissions = null
  const api = {
    getChatMember: async () => ({ status: 'member' }),
    restrictChatMember: async (_chat, _user, next) => { permissions = next },
  }
  const result = await grantAccess(api, config, '42')
  assert.equal(result.granted, true)
  assert.equal(permissions.can_send_messages, true)
})

test('mutes a member instead of kicking them', async () => {
  const calls = []
  const api = {
    getChatMember: async () => ({ status: 'member' }),
    restrictChatMember: async (...args) => { calls.push(args) },
    banChatMember: async () => { throw new Error('should not kick') },
  }
  await revokeAccess(api, config, '42')
  assert.equal(calls[0][2].can_send_messages, false)
})

test('refuses to mute an admin', async () => {
  const api = { getChatMember: async () => ({ status: 'administrator' }) }
  await assert.rejects(() => revokeAccess(api, config, '42'), /admin/)
})

test('describes a missing admin right', () => {
  const text = accessErrorText({ error_code: 403, description: 'Forbidden: not enough rights' })
  assert.match(text, /Ban Users/)
})

test('describes a missing invite-link right', () => {
  const text = accessErrorText({ error_code: 400, description: 'Bad Request: not enough rights to manage chat invite link' })
  assert.match(text, /Invite Users is off/)
})

test('warns when the bot cannot invite', () => {
  const info = describeBotAccess(
    { status: 'administrator', can_invite_users: false, can_restrict_members: true },
    { title: 'DATUM Gateway', join_by_request: true },
  )
  assert.equal(info.isAdmin, true)
  assert.equal(info.canInvite, false)
  assert.match(botAccessWarning(info), /Invite Users is off/)
  assert.equal(botAccessWarning({ isAdmin: true, canInvite: true, canRestrict: true }), null)
})
