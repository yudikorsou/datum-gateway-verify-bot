import * as ecc from 'tiny-secp256k1'
import { initEccLib } from 'bitcoinjs-lib'
import bitcoinMessage from 'bitcoinjs-message'
import { Verifier } from 'bip322-js'
import { inspectAddress } from './address.js'

initEccLib(ecc)

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const HEX = /^(?:[0-9a-fA-F]{2})+$/

function isIgnorableLine(line) {
  if (!line) return true
  if (line.startsWith('-----')) return true
  return inspectAddress(line).ok
}

function isSignatureBlob(value) {
  return value.length >= 20 && (BASE64.test(value) || HEX.test(value))
}

export function signatureCandidates(input) {
  const text = String(input ?? '').trim()
  if (!text) return []
  const armored = text.match(/-----BEGIN SIGNATURE-----([\s\S]*?)-----END/i)
  const body = armored ? armored[1] : text
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const chunks = lines
    .filter((line) => !isIgnorableLine(line))
    .map((line) => line.replace(/\s+/g, ''))
    .filter(isSignatureBlob)
  const out = []
  if (chunks.length) {
    const joined = chunks.join('')
    if (isSignatureBlob(joined)) out.push(joined)
  }
  const compact = body.replace(/\s+/g, '')
  if (isSignatureBlob(compact) && !inspectAddress(compact).ok) out.push(compact)
  return [...new Set(out)]
}

export function extractSignature(input) {
  return signatureCandidates(input)[0] || null
}

function encodingsOf(signature) {
  const values = [signature]
  if (HEX.test(signature) && signature.length >= 64 && signature.length % 2 === 0) {
    values.push(Buffer.from(signature, 'hex').toString('base64'))
  }
  return [...new Set(values)]
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
  const candidates = signatureCandidates(signatureText)
  if (!candidates.length) {
    return {
      ok: false,
      reason: 'Paste the signature from your wallet. A raw base64 signature or a full “Bitcoin Signed Message” block both work. Taproot (bc1p…) needs BIP322.',
    }
  }

  for (const candidate of candidates) {
    for (const signature of encodingsOf(candidate)) {
      for (const variant of messageVariants(message)) {
        if (info.type !== 'p2tr' && verifyBitcoinMessage(variant, info.canonical, signature)) {
          return { ok: true, method: 'bitcoin-message', address: info.canonical }
        }
        if (verifyBip322(info.canonical, variant, signature)) {
          return { ok: true, method: 'bip322', address: info.canonical }
        }
      }
    }
  }
  return {
    ok: false,
    reason: 'That signature does not match this address and message. Sign the exact text, in a wallet that can spend the address, and paste the result again. Taproot (bc1p…) needs BIP322 (Simple).',
  }
}
