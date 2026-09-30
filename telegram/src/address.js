import * as ecc from 'tiny-secp256k1'
import { address as btcAddress, initEccLib, networks } from 'bitcoinjs-lib'

initEccLib(ecc)

const NETWORK = networks.bitcoin

const TYPE_BY_SCRIPT = [
  { type: 'p2pkh', label: 'P2PKH (legacy, starts with 1)', test: (script) => script.length === 25 && script[0] === 0x76 && script[1] === 0xa9 },
  { type: 'p2sh', label: 'P2SH (starts with 3)', test: (script) => script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 },
  { type: 'p2wpkh', label: 'P2WPKH (native SegWit, bc1q)', test: (script) => script.length === 22 && script[0] === 0x00 && script[1] === 0x14 },
  { type: 'p2wsh', label: 'P2WSH (bc1q, 32-byte witness)', test: (script) => script.length === 34 && script[0] === 0x00 && script[1] === 0x20 },
  { type: 'p2tr', label: 'P2TR (Taproot, bc1p)', test: (script) => script.length === 34 && script[0] === 0x51 && script[1] === 0x20 },
]

const SIGNABLE = new Set(['p2pkh', 'p2sh', 'p2wpkh', 'p2tr'])

export function inspectAddress(raw) {
  const input = String(raw ?? '').trim()
  if (!input) return { ok: false, error: 'Enter a public Bitcoin address.' }

  const dot = input.indexOf('.')
  if (dot > 0) {
    const head = input.slice(0, dot)
    const headInfo = inspectAddress(head)
    if (headInfo.ok) {
      return {
        ok: false,
        error: `Use the payout address itself (${headInfo.canonical}), without the .worker suffix pools accept in miner usernames.`,
      }
    }
  }

  let script
  try {
    script = btcAddress.toOutputScript(input, NETWORK)
  } catch {
    return {
      ok: false,
      error: 'That is not a mainnet Bitcoin address. Shrike, Sparrow, and Bitcoin Core addresses look like 1…, 3…, bc1q…, or bc1p….',
    }
  }

  const match = TYPE_BY_SCRIPT.find((entry) => entry.test(script))
  if (!match) {
    return { ok: false, error: 'That address type is not supported for message signing.' }
  }
  if (!SIGNABLE.has(match.type)) {
    return {
      ok: false,
      error: `${match.label} cannot be checked with a standard message signature. Use a single-sig P2PKH, nested SegWit, native SegWit, or Taproot address.`,
    }
  }

  const canonical = match.type === 'p2wpkh' || match.type === 'p2tr' ? input.toLowerCase() : input
  return { ok: true, canonical, type: match.type, label: match.label }
}

export function sameAddress(left, right) {
  const a = inspectAddress(left)
  const b = inspectAddress(right)
  if (!a.ok || !b.ok) return false
  return a.canonical === b.canonical
}
