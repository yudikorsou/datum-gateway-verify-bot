import { Routes } from 'discord.js'

export async function grantRole(client, config, userId) {
  await client.rest.put(Routes.guildMemberRole(config.guildId, userId, config.roleId))
}

export async function revokeRole(client, config, userId) {
  try {
    await client.rest.delete(Routes.guildMemberRole(config.guildId, userId, config.roleId))
  } catch (error) {
    if (error.status === 404 || error.code === 10007 || error.code === 10011) return
    throw error
  }
}

export function roleErrorText(error) {
  if (error.code === 50013 || error.status === 403) {
    return 'The bot could not change roles. Give it Manage Roles, and drag its role above the verified-miner role.'
  }
  if (error.code === 10011) return 'VERIFIED_ROLE_ID does not match a role in this server.'
  if (error.code === 10007) return 'That Discord user is not in the server.'
  return error.message || 'Discord rejected the role change.'
}
