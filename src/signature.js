import * as ecc from 'tiny-secp256k1'
import { initEccLib } from 'bitcoinjs-lib'
import bitcoinMessage from 'bitcoinjs-message'
import { Verifier } from 'bip322-js'
import { inspectAddress } from './address.js'

initEccLib(ecc)

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

const ADDRESS_LINE = /^(bc1|[13]|tb1|2)/i

export function extractSignature(input) {
  const text = String(input ?? '').trim()
  if (!text) return null
  const armored = text.match(/-----BEGIN SIGNATURE-----([\s\S]*?)-----END/i)
  const body = armored ? armored[1] : text
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const chunks = lines
    .filter((line) => !ADDRESS_LINE.test(line) && !line.startsWith('-----'))
    .map((line) => line.replace(/\s+/g, ''))
    .filter((line) => line.length >= 20 && BASE64.test(line))
  if (chunks.length) {
    const joined = chunks.join('')
    if (joined.length >= 20 && BASE64.test(joined)) return joined
  }
  const compact = body.replace(/\s+/g, '')
  if (compact.length >= 20 && BASE64.test(compact) && !ADDRESS_LINE.test(compact)) return compact
  return null
}

function messageVariants(message) {
  const lf = String(message).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const crlf = lf.replace(/\n/g, '\r\n')
  const trimmed = lf.split('\n').map((line) => line.trimEnd()).join('\n').trim()
  return [...new Set([message, lf, crlf, trimmed, `${trimmed}\n`])]
}

function verifyBitcoinMessage(message, address, signature) {
  try {
    return bitcoinMessage.verify(message, address, signature) === true
  } catch {
    return false
  }
}

function verifyBip322(address, message, signature) {
  try {
    return Verifier.verifySignature(address, message, signature) === true
  } catch {
    return false
  }
}

export function verifyOwnership(address, message, signatureText) {
  const info = inspectAddress(address)
  if (!info.ok) return { ok: false, reason: info.error }
  const signature = extractSignature(signatureText)
  if (!signature) {
    return {
      ok: false,
      reason: 'Paste the signature from your wallet. A raw base64 signature or a full “Bitcoin Signed Message” block both work.',
    }
  }

  for (const variant of messageVariants(message)) {
    if (info.type !== 'p2tr' && verifyBitcoinMessage(variant, info.canonical, signature)) {
      return { ok: true, method: 'bitcoin-message', address: info.canonical }
    }
    if (verifyBip322(info.canonical, variant, signature)) {
      return { ok: true, method: 'bip322', address: info.canonical }
    }
  }
  return {
    ok: false,
    reason: 'That signature does not match this address and message. Sign the exact text, in a wallet that can spend the address, and paste the result again.',
  }
}
