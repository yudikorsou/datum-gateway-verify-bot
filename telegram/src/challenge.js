import { randomBytes } from 'node:crypto'

const NONCE = /^[0-9a-f]{32}$/

export function challengeMessage({ telegramId, address, nonce, issued }) {
  return [
    'DATUM Gateway Telegram verification',
    `Telegram user: ${telegramId}`,
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issued}`,
  ].join('\n')
}

export function createChallenge({ telegramId, address, now = Date.now(), nonce, issued } = {}) {
  const useNonce = typeof nonce === 'string' && NONCE.test(nonce) ? nonce : randomBytes(16).toString('hex')
  let issuedAt = new Date(now).toISOString()
  if (typeof issued === 'string') {
    const parsed = Date.parse(issued)
    if (Number.isFinite(parsed) && Math.abs(parsed - now) < 30 * 60 * 1000) {
      issuedAt = issued
    }
  }
  return {
    nonce: useNonce,
    message: challengeMessage({
      telegramId,
      address,
      nonce: useNonce,
      issued: issuedAt,
    }),
  }
}
