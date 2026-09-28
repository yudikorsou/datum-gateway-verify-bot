const FULL_MEMBER = {
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

function userId(id) {
  const value = Number(id)
  if (!Number.isSafeInteger(value)) throw new Error('Telegram user id is not a safe integer.')
  return value
}

export function accessErrorText(error) {
  const description = error?.description || error?.message || ''
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

export async function grantAccess(api, config, rawUserId, { inviteIfAbsent = true } = {}) {
  const id = userId(rawUserId)
  const chatId = config.chatId
  const status = await memberStatus(api, chatId, id)

  if (status === 'creator' || status === 'administrator' || status === 'member') {
    return { granted: true, absent: false, inviteLink: null, note: 'You are already in the community.' }
  }

  if (status === 'restricted') {
    await api.restrictChatMember(chatId, id, FULL_MEMBER, { use_independent_chat_permissions: true })
    return { granted: true, absent: false, inviteLink: null, note: 'Restrictions lifted. You can use the community.' }
  }

  if (status === 'kicked') {
    await api.unbanChatMember(chatId, id, { only_if_banned: true })
  }

  try {
    await api.approveChatJoinRequest(chatId, id)
    return { granted: true, absent: false, inviteLink: null, note: 'Your join request was approved.' }
  } catch (error) {
    if (!missingJoinRequest(error)) throw error
  }

  if (!inviteIfAbsent) {
    return { granted: false, absent: true, inviteLink: null, note: null }
  }

  const link = await api.createChatInviteLink(chatId, {
    member_limit: 1,
    creates_join_request: false,
    name: `datum-${id}`.slice(0, 32),
  })
  return {
    granted: true,
    absent: false,
    inviteLink: link.invite_link,
    note: 'This invite works once. Open it to enter the community.',
  }
}

export async function revokeAccess(api, config, rawUserId) {
  const id = userId(rawUserId)
  const status = await memberStatus(api, config.chatId, id)
  if (!status || status === 'left' || status === 'kicked') return
  if (status === 'creator' || status === 'administrator') {
    throw Object.assign(new Error('That member is an admin, so the bot cannot remove them.'), { error_code: 403 })
  }
  await api.banChatMember(config.chatId, id)
  await api.unbanChatMember(config.chatId, id)
}
