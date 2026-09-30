import { Routes } from 'discord.js'

export function communities(config) {
  if (Array.isArray(config?.guilds) && config.guilds.length) return config.guilds
  if (config?.guildId && config?.roleId) return [{ guildId: config.guildId, roleId: config.roleId }]
  return []
}

export async function grantRole(client, community, userId) {
  await client.rest.put(Routes.guildMemberRole(community.guildId, userId, community.roleId))
}

export async function revokeRole(client, community, userId) {
  try {
    await client.rest.delete(Routes.guildMemberRole(community.guildId, userId, community.roleId))
  } catch (error) {
    if (error.status === 404 || error.code === 10007 || error.code === 10011) return
    throw error
  }
}

export function isUnknownMember(error) {
  return error?.code === 10007
}

export async function memberRoleState(client, community, userId) {
  try {
    const member = await client.rest.get(Routes.guildMember(community.guildId, userId))
    return { inServer: true, hasRole: member.roles.includes(community.roleId) }
  } catch (error) {
    if (isUnknownMember(error)) return { inServer: false, hasRole: false }
    throw error
  }
}

export async function anyMemberRoleState(client, config, userId, preferredGuildId = null) {
  const preferred = communities(config).find((entry) => entry.guildId === String(preferredGuildId || ''))
  const ordered = preferred
    ? [preferred, ...communities(config).filter((entry) => entry.guildId !== preferred.guildId)]
    : communities(config)
  let inServer = false
  for (const community of ordered) {
    const state = await memberRoleState(client, community, userId)
    if (state.inServer) inServer = true
    if (state.hasRole) return { inServer: true, hasRole: true }
  }
  return { inServer, hasRole: false }
}

export async function grantRolesInCommunities(client, config, userId) {
  let granted = 0
  let unknownEverywhere = true
  let lastError = null
  for (const community of communities(config)) {
    try {
      await grantRole(client, community, userId)
      granted += 1
      unknownEverywhere = false
    } catch (error) {
      if (isUnknownMember(error)) continue
      unknownEverywhere = false
      lastError = error
    }
  }
  if (granted > 0) return { granted: true, count: granted }
  if (unknownEverywhere) {
    const error = new Error('That Discord user is not in any configured server.')
    error.code = 10007
    throw error
  }
  if (lastError) throw lastError
  return { granted: false, count: 0 }
}

export async function revokeRolesInCommunities(client, config, userId) {
  for (const community of communities(config)) {
    await revokeRole(client, community, userId)
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
