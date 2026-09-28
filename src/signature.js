import * as ecc from 'tiny-secp256k1'
import { initEccLib } from 'bitcoinjs-lib'
import bitcoinMessage from 'bitcoinjs-message'
import { Verifier } from 'bip322-js'
import { inspectAddress } from './address.js'

initEccLib(ecc)

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

export function extractSignature(input) {
  const text = String(input ?? '').trim()
  if (!text) return null
  const armored = text.match(/-----BEGIN SIGNATURE-----([\s\S]*?)-----END/i)
  const body = armored ? armored[1] : text
  const tokens = body.split(/\s+/).map((part) => part.trim()).filter(Boolean)
  const candidates = tokens.filter((token) => token.length >= 20 && BASE64.test(token))
  if (candidates.length) return candidates[candidates.length - 1]
  const compact = text.replace(/\s+/g, '')
  if (compact.length >= 20 && BASE64.test(compact)) return compact
  return null
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

  if (info.type !== 'p2tr' && verifyBitcoinMessage(message, info.canonical, signature)) {
    return { ok: true, method: 'bitcoin-message', address: info.canonical }
  }
  if (verifyBip322(info.canonical, message, signature)) {
    return { ok: true, method: 'bip322', address: info.canonical }
  }
  return {
    ok: false,
    reason: 'That signature does not match this address and message. Sign the exact text, in a wallet that can spend the address, and paste the result again.',
  }
}
