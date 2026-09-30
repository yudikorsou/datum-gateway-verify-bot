import assert from 'node:assert/strict'
import test from 'node:test'
import { payments, networks, initEccLib } from 'bitcoinjs-lib'
import { ECPairFactory } from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import bitcoinMessage from 'bitcoinjs-message'
import { Signer } from 'bip322-js'
import { extractSignature, verifyOwnership } from '../src/signature.js'

initEccLib(ecc)
const ECPair = ECPairFactory(ecc)
const network = networks.bitcoin
const message = 'DATUM Gateway Discord verification\nDiscord user: 42\nNonce: abc'

function wallet() {
  const key = ECPair.makeRandom()
  const privateKey = Buffer.from(key.privateKey)
  const pubkey = Buffer.from(key.publicKey)
  return { key, privateKey, pubkey }
}

test('classic signatures prove P2PKH, nested SegWit, and native SegWit', () => {
  const { privateKey, pubkey, key } = wallet()
  const cases = [
    {
      address: payments.p2pkh({ pubkey, network }).address,
      signature: bitcoinMessage.sign(message, privateKey, key.compressed),
    },
    {
      address: payments.p2wpkh({ pubkey, network }).address,
      signature: bitcoinMessage.sign(message, privateKey, key.compressed, { segwitType: 'p2wpkh' }),
    },
    {
      address: payments.p2sh({ redeem: payments.p2wpkh({ pubkey, network }), network }).address,
      signature: bitcoinMessage.sign(message, privateKey, key.compressed, { segwitType: 'p2sh(p2wpkh)' }),
    },
  ]
  for (const entry of cases) {
    const proof = verifyOwnership(entry.address, message, entry.signature.toString('base64'))
    assert.equal(proof.ok, true, entry.address)
    assert.equal(proof.method, 'bitcoin-message')
  }
})

test('BIP322 signatures prove Taproot addresses', () => {
  const { key, pubkey } = wallet()
  const address = payments.p2tr({ internalPubkey: pubkey.slice(1, 33), network }).address
  const signature = Signer.sign(key.toWIF(), address, message)
  const proof = verifyOwnership(address, message, signature)
  assert.equal(proof.ok, true)
  assert.equal(proof.method, 'bip322')
})

function wrap64(text) {
  return String(text).match(/.{1,64}/g).join('\n')
}

test('BIP322 still works when wallets wrap, armor, or paste hex', () => {
  let remainderLookedLikeAddress = false
  for (let i = 0; i < 200 && (i < 8 || !remainderLookedLikeAddress); i++) {
    const { key, pubkey } = wallet()
    const address = payments.p2tr({ internalPubkey: pubkey.slice(1, 33), network }).address
    const signature = Signer.sign(key.toWIF(), address, message)
    const wrapped = wrap64(signature)
    if (/^(bc1|[13]|tb1|2)/i.test(signature.slice(64))) remainderLookedLikeAddress = true
    const proof = verifyOwnership(address, message, wrapped)
    assert.equal(proof.ok, true, address)
    assert.equal(proof.method, 'bip322')
    if (i === 0) {
      const hex = Buffer.from(signature, 'base64').toString('hex')
      const hexProof = verifyOwnership(address, message, hex)
      assert.equal(hexProof.ok, true)
      assert.equal(hexProof.method, 'bip322')
      const armored = [
        '-----BEGIN BITCOIN SIGNED MESSAGE-----',
        message,
        '-----BEGIN SIGNATURE-----',
        address,
        wrapped,
        '-----END BITCOIN SIGNED MESSAGE-----',
      ].join('\n')
      assert.equal(extractSignature(armored), signature)
      assert.equal(verifyOwnership(address, message, armored).ok, true)
      assert.equal(verifyOwnership(address, message.replaceAll('\n', '\r\n'), signature).ok, true)
    }
  }
  assert.equal(remainderLookedLikeAddress, true)
})

test('a signature for a different message or address is rejected', () => {
  const { privateKey, pubkey, key } = wallet()
  const address = payments.p2pkh({ pubkey, network }).address
  const signature = bitcoinMessage.sign(message, privateKey, key.compressed).toString('base64')
  assert.equal(verifyOwnership(address, 'other message', signature).ok, false)
  const other = payments.p2pkh({ pubkey: Buffer.from(ECPair.makeRandom().publicKey), network }).address
  assert.equal(verifyOwnership(other, message, signature).ok, false)
})

test('armored signed-message blocks are accepted', () => {
  const { privateKey, pubkey, key } = wallet()
  const address = payments.p2pkh({ pubkey, network }).address
  const signature = bitcoinMessage.sign(message, privateKey, key.compressed).toString('base64')
  const armored = [
    '-----BEGIN BITCOIN SIGNED MESSAGE-----',
    message,
    '-----BEGIN SIGNATURE-----',
    address,
    signature,
    '-----END BITCOIN SIGNED MESSAGE-----',
  ].join('\n')
  assert.equal(extractSignature(armored), signature)
  assert.equal(verifyOwnership(address, message, armored).ok, true)
})
