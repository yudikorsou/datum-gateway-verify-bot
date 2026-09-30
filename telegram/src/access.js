import { communityConfig, configuredChatIds } from './config.js'

export const FULL_MEMBER = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_invite_users: true,
}

export const MUTED = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
}

export const VERIFY_TYPING = {
  ...MUTED,
  can_send_messages: true,
}

function userId(id) {
  const value = Number(id)
  if (!Number.isSafeInteger(value)) throw new Error('Telegram user id is not a safe integer.')
  return value
}

export function describeBotAccess(member, chat) {
  return {
    status: member?.status || null,
    title: chat?.title || null,
    isAdmin: member?.status === 'administrator' || member?.status === 'creator',
    canInvite: Boolean(member?.can_invite_users),
    canRestrict: Boolean(member?.can_restrict_members),
    joinByRequest: Boolean(chat?.join_by_request),
  }
}

export function botAccessWarning(info) {
  if (!info?.isAdmin) {
    return 'The bot is not an admin in the community. Promote @datumgatewaybot and enable Invite Users and Ban Users.'
  }
  if (!info.canInvite) {
    return 'Invite Users is off. The bot can verify addresses but cannot approve members or send invite links. In the community: Administrators → DATUM Gateway → enable Invite Users via link.'
  }
  if (!info.canRestrict) {
    return 'Ban Users is off. Daily scans cannot remove members who stop hashing through DATUM Gateway.'
  }
  return null
}

export async function inspectBotAccess(api, config, chatId = null) {
  const target = chatId || config.chatId
  if (!target) {
    return {
      ok: false,
      warning: 'No Telegram communities configured. Send /chatid in each community, save those numbers, and restart.',
    }
  }
  const scoped = communityConfig(config, target)
  const me = await api.getMe()
  const chat = await api.getChat(scoped.chatId)
  const member = await api.getChatMember(scoped.chatId, me.id)
  const info = describeBotAccess(member, chat)
  const warning = botAccessWarning(info)
  return { ok: !warning, chatId: scoped.chatId, ...info, warning }
}

export async function inspectAllCommunities(api, config) {
  const ids = configuredChatIds(config)
  if (!ids.length) {
    return [{ ok: false, warning: 'No Telegram communities configured. Send /chatid in each community, save those numbers, and restart.' }]
  }
  const results = []
  for (const chatId of ids) {
    results.push(await inspectBotAccess(api, config, chatId))
  }
  return results
}

export function accessErrorText(error) {
  const description = error?.description || error?.message || ''
  if (/invite link|not enough rights to manage chat invite/i.test(description)) {
    return 'The bot is an admin but Invite Users is off. In DATUM Gateway → Administrators → DATUM Gateway, enable Invite Users via link. Ban Users can stay on.'
  }
  if (error?.error_code === 403 || /not enough rights|CHAT_ADMIN_REQUIRED|need administrator/i.test(description)) {
    return 'The bot could not change membership. Make it an admin with Invite Users and Ban Users, and put it in the community.'
  }
  if (/chat not found/i.test(description)) return 'TELEGRAM_CHAT_ID does not match a chat this bot is in.'
  if (/user not found|PARTICIPANT_ID_INVALID|user is deactivated/i.test(description)) {
    return 'That Telegram user is not reachable.'
  }
  return description || 'Telegram rejected the membership change.'
}

async function memberStatus(api, chatId, id) {
  try {
    const member = await api.getChatMember(chatId, id)
    return member?.status || null
  } catch (error) {
    if (error?.error_code === 400) return null
    throw error
  }
}

function missingJoinRequest(error) {
  return error?.error_code === 400
}

function requireChat(config) {
  if (!config.chatId) {
    throw new Error('No Telegram community chat id is set. Send /chatid in the community, save that number, and restart.')
  }
}

async function unmute(api, chatId, id) {
  await api.restrictChatMember(chatId, id, FULL_MEMBER, { use_independent_chat_permissions: true })
}

export async function applyReadOnlyDefaults(api, config, chatId = null) {
  const ids = chatId ? [String(chatId)] : configuredChatIds(config)
  if (!ids.length) requireChat(config)
  for (const id of ids) {
    await api.setChatPermissions(id, MUTED, { use_independent_chat_permissions: true })
  }
}

export async function muteMember(api, config, rawUserId, chatId = null) {
  const scoped = communityConfig(config, chatId || config.chatId)
  requireChat(scoped)
  const id = userId(rawUserId)
  const status = await memberStatus(api, scoped.chatId, id)
  if (!status || status === 'left' || status === 'kicked') return
  if (status === 'creator' || status === 'administrator') return
  await api.restrictChatMember(scoped.chatId, id, MUTED, { use_independent_chat_permissions: true })
}

export async function allowVerifyTyping(api, config, rawUserId, chatId = null) {
  const scoped = communityConfig(config, chatId || config.chatId)
  requireChat(scoped)
  const id = userId(rawUserId)
  const status = await memberStatus(api, scoped.chatId, id)
  if (!status || status === 'left' || status === 'kicked') return
  if (status === 'creator' || status === 'administrator') return
  await api.restrictChatMember(scoped.chatId, id, VERIFY_TYPING, { use_independent_chat_permissions: true })
}

export async function grantAccess(api, config, rawUserId, { inviteIfAbsent = true, chatId = null } = {}) {
  const scoped = communityConfig(config, chatId || config.chatId)
  requireChat(scoped)
  const id = userId(rawUserId)
  const targetChatId = scoped.chatId
  let status = await memberStatus(api, targetChatId, id)

  if (status === 'creator' || status === 'administrator') {
    return { granted: true, absent: false, inviteLink: null, note: 'You are already an admin in the community.' }
  }

  if (status === 'member' || status === 'restricted') {
    await unmute(api, targetChatId, id)
    return { granted: true, absent: false, inviteLink: null, note: 'You can send messages in the community now.' }
  }

  if (status === 'kicked') {
    await api.unbanChatMember(targetChatId, id, { only_if_banned: true })
  }

  let approved = false
  try {
    await api.approveChatJoinRequest(targetChatId, id)
    approved = true
  } catch (error) {
    if (!missingJoinRequest(error)) throw error
  }

  status = await memberStatus(api, targetChatId, id)
  if (status === 'member' || status === 'restricted') {
    await unmute(api, targetChatId, id)
    return { granted: true, absent: false, inviteLink: null, note: 'You can send messages in the community now.' }
  }
  if (status === 'creator' || status === 'administrator') {
    return { granted: true, absent: false, inviteLink: null, note: 'You are already an admin in the community.' }
  }
  if (approved) {
    return { granted: true, absent: false, inviteLink: null, note: 'Your join request was approved. You can read the chat; sending unlocks after DATUM verification.' }
  }

  if (!inviteIfAbsent) {
    return { granted: false, absent: true, inviteLink: null, note: null }
  }

  const link = await api.createChatInviteLink(targetChatId, {
    member_limit: 1,
    creates_join_request: false,
    name: `datum-${id}`.slice(0, 32),
  })
  return {
    granted: true,
    absent: false,
    inviteLink: link.invite_link,
    note: 'This invite works once. Open it to enter the community, then tap Verify in this chat if sending is still locked.',
  }
}

export async function grantAccessInCommunities(api, config, rawUserId, { inviteIfAbsent = true } = {}) {
  const ids = configuredChatIds(config)
  if (!ids.length) requireChat(config)
  let granted = false
  let inviteLink = null
  let note = null
  for (const chatId of ids) {
    try {
      const result = await grantAccess(api, config, rawUserId, { inviteIfAbsent, chatId })
      if (result.granted) granted = true
      if (result.inviteLink && !inviteLink) inviteLink = result.inviteLink
      if (result.note) note = result.note
    } catch (error) {
      console.error(`could not grant access in chat ${chatId}`, error?.description || error?.message)
    }
  }
  return { granted, absent: !granted, inviteLink, note }
}

export async function revokeAccess(api, config, rawUserId, chatId = null) {
  const scoped = communityConfig(config, chatId || config.chatId)
  requireChat(scoped)
  const id = userId(rawUserId)
  const status = await memberStatus(api, scoped.chatId, id)
  if (!status || status === 'left' || status === 'kicked') return
  if (status === 'creator' || status === 'administrator') {
    throw Object.assign(new Error('That member is an admin, so the bot cannot mute them.'), { error_code: 403 })
  }
  await api.restrictChatMember(scoped.chatId, id, MUTED, { use_independent_chat_permissions: true })
}

export async function revokeAccessInCommunities(api, config, rawUserId) {
  const ids = configuredChatIds(config)
  if (!ids.length) requireChat(config)
  for (const chatId of ids) {
    try {
      await revokeAccess(api, config, rawUserId, chatId)
    } catch (error) {
      if (error?.error_code === 403) continue
      console.error(`could not revoke access in chat ${chatId}`, error?.description || error?.message)
    }
  }
}
