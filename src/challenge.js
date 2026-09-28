import { randomBytes } from 'node:crypto'

export function createChallenge({ telegramId, address, now = Date.now() }) {
  const nonce = randomBytes(16).toString('hex')
  const message = [
    'DATUM Gateway Telegram verification',
    `Telegram user: ${telegramId}`,
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date(now).toISOString()}`,
  ].join('\n')
  return { nonce, message }
}
