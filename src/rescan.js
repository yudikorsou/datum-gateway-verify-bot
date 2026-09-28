import { grantAccess, revokeAccess } from './access.js'
import { listMiners, recordScan } from './db.js'
import { membershipAction } from './policy.js'
import { loadSharedSnapshots, scanAddress } from './pools/scan.js'
import { removedText } from './present.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function rescanMiners(api, db, config, hooks = {}) {
  const scan = hooks.scanAddress || scanAddress
  const loadShared = hooks.loadSharedSnapshots || loadSharedSnapshots
  const grant = hooks.grantAccess || grantAccess
  const revoke = hooks.revokeAccess || revokeAccess
  const wait = hooks.sleep || sleep
  const notify = hooks.notify || ((userId, address) => api.sendMessage(userId, removedText(address), { parse_mode: 'HTML' }))

  const miners = listMiners(db)
  if (!miners.length) {
    console.log('daily scan: no linked miners')
    return
  }
  const shared = await loadShared()
  for (const miner of miners) {
    try {
      const result = await scan(miner.address, config, shared)
      const scannedAt = Date.now()
      const action = membershipAction(result)
      if (action === 'keep') {
        let roleGranted = Boolean(miner.roleGranted)
        try {
          const access = await grant(api, config, miner.telegramId, { inviteIfAbsent: !miner.roleGranted })
          if (access.granted) {
            roleGranted = true
            if (access.inviteLink) {
              await api.sendMessage(
                miner.telegramId,
                `DATUM shares are still fresh. This invite works once:\n${access.inviteLink}`,
              )
            }
          }
        } catch (error) {
          console.error(`daily scan: access refresh failed for ${miner.telegramId}`, error.message)
        }
        recordScan(db, miner.telegramId, { roleGranted, scannedAt, scan: result })
        console.log(`daily scan: kept ${miner.telegramId}`)
      } else if (action === 'skip') {
        recordScan(db, miner.telegramId, { roleGranted: Boolean(miner.roleGranted), scannedAt, scan: result })
        console.log(`daily scan: skipped ${miner.telegramId} because a pool did not answer`)
      } else {
        await revoke(api, config, miner.telegramId)
        recordScan(db, miner.telegramId, { roleGranted: false, scannedAt, scan: result })
        console.log(`daily scan: removed access from ${miner.telegramId}`)
        try {
          await notify(miner.telegramId, miner.address)
        } catch (error) {
          console.error(`daily scan: could not message ${miner.telegramId}`, error.message)
        }
      }
    } catch (error) {
      console.error(`daily scan failed for ${miner.telegramId}`, error)
    }
    await wait(400)
  }
}
