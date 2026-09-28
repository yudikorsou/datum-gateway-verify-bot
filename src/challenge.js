import { randomBytes } from 'node:crypto'

export function createChallenge({ discordId, address, now = Date.now() }) {
  const nonce = randomBytes(16).toString('hex')
  const message = [
    'DATUM Gateway Discord verification',
    `Discord user: ${discordId}`,
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date(now).toISOString()}`,
  ].join('\n')
  return { nonce, message }
}
