import assert from 'node:assert/strict'
import test from 'node:test'
import { payments, networks, initEccLib } from 'bitcoinjs-lib'
import { ECPairFactory } from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import { inspectAddress, sameAddress } from '../src/address.js'

initEccLib(ecc)
const ECPair = ECPairFactory(ecc)
const key = ECPair.makeRandom()
const pubkey = Buffer.from(key.publicKey)
const network = networks.bitcoin

test('accepts the address types Shrike and the pools use', () => {
  const p2pkh = payments.p2pkh({ pubkey, network }).address
  const nested = payments.p2sh({ redeem: payments.p2wpkh({ pubkey, network }), network }).address
  const p2wpkh = payments.p2wpkh({ pubkey, network }).address
  const p2tr = payments.p2tr({ internalPubkey: pubkey.slice(1, 33), network }).address
  for (const address of [p2pkh, nested, p2wpkh, p2tr]) {
    const info = inspectAddress(address)
    assert.equal(info.ok, true, address)
  }
  assert.equal(inspectAddress(p2wpkh).type, 'p2wpkh')
  assert.equal(inspectAddress(p2tr).type, 'p2tr')
  assert.equal(inspectAddress(p2pkh).type, 'p2pkh')
  assert.equal(inspectAddress(nested).type, 'p2sh')
})

test('rejects testnet, worker suffixes, and bare witness scripts', () => {
  const rejected = inspectAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')
  assert.equal(rejected.ok, false)

  const withWorker = inspectAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4.rig1')
  assert.equal(withWorker.ok, false)
  assert.match(withWorker.error, /without the \.worker suffix/)

  const p2wsh = payments.p2wsh({
    redeem: payments.p2pkh({ pubkey, network }),
    network,
  }).address
  assert.equal(inspectAddress(p2wsh).ok, false)
})

test('matches bech32 addresses case-insensitively', () => {
  const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
  assert.equal(sameAddress(address, address.toUpperCase()), true)
  assert.equal(sameAddress(address, '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'), false)
})
