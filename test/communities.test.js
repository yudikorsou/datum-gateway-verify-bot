import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGuilds, guildEntry } from '../src/config.js'
import { communities, grantRolesInCommunities, revokeRolesInCommunities } from '../src/roles.js'

test('legacy guild and role become one community', () => {
  const guilds = normalizeGuilds({
    DISCORD_GUILD_ID: '111',
    VERIFIED_ROLE_ID: '222',
  })
  assert.deepEqual(guilds, [{ guildId: '111', roleId: '222' }])
})

test('DISCORD_COMMUNITIES adds extra servers without dropping the legacy pair', () => {
  const guilds = normalizeGuilds({
    DISCORD_GUILD_ID: '111',
    VERIFIED_ROLE_ID: '222',
    DISCORD_COMMUNITIES: JSON.stringify([
      { guildId: '333', roleId: '444' },
      { guildId: '111', roleId: '222' },
    ]),
  })
  assert.deepEqual(guilds, [
    { guildId: '333', roleId: '444' },
    { guildId: '111', roleId: '222' },
  ])
})

test('guildEntry finds a configured server', () => {
  const config = { guilds: [{ guildId: '1', roleId: 'a' }, { guildId: '2', roleId: 'b' }] }
  assert.deepEqual(guildEntry(config, '2'), { guildId: '2', roleId: 'b' })
  assert.equal(guildEntry(config, '9'), null)
})

test('grant and revoke fan out across every configured community', async () => {
  const calls = []
  const client = {
    rest: {
      async put(route) {
        calls.push(['put', route])
      },
      async delete(route) {
        calls.push(['delete', route])
      },
    },
  }
  const config = {
    guilds: [
      { guildId: 'g1', roleId: 'r1' },
      { guildId: 'g2', roleId: 'r2' },
    ],
  }
  assert.deepEqual(communities(config), config.guilds)
  const granted = await grantRolesInCommunities(client, config, 'user-1')
  assert.equal(granted.count, 2)
  await revokeRolesInCommunities(client, config, 'user-1')
  assert.equal(calls.filter((entry) => entry[0] === 'put').length, 2)
  assert.equal(calls.filter((entry) => entry[0] === 'delete').length, 2)
})
