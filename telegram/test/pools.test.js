import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  evaluateB2,
  evaluateBlockvase,
  evaluateConvoy,
  evaluateLazarus,
  evaluateOmega,
  evaluatePaperclip,
  evaluateRiptide,
  parseConvoyWorkers,
} from '../src/pools/evaluate.js'

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
const DAY = 24 * 60 * 60

test('Lazarus counts a fresh DATUM gateway share and ignores public stratum', () => {
  const datum = evaluateLazarus({
    known: true,
    workers: [{ fee_path: 'datum', via: 'prime', last_share_s: 12, gateway_name: 'DATUM User' }],
  }, ADDRESS, { maxAgeSec: DAY })
  assert.equal(datum.activeDatum, true)

  const stale = evaluateLazarus({
    known: true,
    workers: [{ fee_path: 'datum', via: 'prime', last_share_s: DAY + 5 }],
  }, ADDRESS, { maxAgeSec: DAY })
  assert.equal(stale.activeDatum, false)

  const stratum = evaluateLazarus({
    known: true,
    workers: [{ fee_path: 'stratum', via: 'stratum', last_share_s: 3 }],
  }, ADDRESS, { maxAgeSec: DAY })
  assert.equal(stratum.activeDatum, false)
  assert.match(stratum.detail, /public stratum/)
})

test('OmegaPool requires own-gateway work plus live hashrate', () => {
  const snapshot = (row) => ({ window: { miners: [row] } })
  const live = evaluateOmega(snapshot({
    identity: ADDRESS,
    own_gateway_work: '100',
    hashrate_hs: 50,
  }), ADDRESS)
  assert.equal(live.activeDatum, true)

  const publicGateway = evaluateOmega(snapshot({
    identity: ADDRESS,
    own_gateway_work: '0',
    hashrate_hs: 50,
  }), ADDRESS)
  assert.equal(publicGateway.activeDatum, false)

  const idle = evaluateOmega(snapshot({
    identity: ADDRESS,
    own_gateway_work: '100',
    hashrate_hs: 0,
  }), ADDRESS)
  assert.equal(idle.activeDatum, false)
})

test('RIPTide only counts live DATUM workers', () => {
  const live = evaluateRiptide({
    address: ADDRESS,
    worker_breakdown: [{ connection_type: 'datum', hashrate_hs: 10 }],
  }, ADDRESS)
  assert.equal(live.activeDatum, true)

  const sv1 = evaluateRiptide({
    address: ADDRESS,
    worker_breakdown: [{ connection_type: 'sv1', hashrate_hs: 10 }],
  }, ADDRESS)
  assert.equal(sv1.activeDatum, false)
})

test('Blockvase counts datum and mixed rows, not sv1', () => {
  const payload = (kind, extra = {}) => ({
    miners: [{ id: ADDRESS, kind, hashrate_hs: 5, datum_work: 0, ...extra }],
  })
  assert.equal(evaluateBlockvase(payload('datum', { datum_work: 9 }), ADDRESS).activeDatum, true)
  assert.equal(evaluateBlockvase(payload('mixed', { datum_work: 9 }), ADDRESS).activeDatum, true)
  assert.equal(evaluateBlockvase(payload('sv1', { datum_work: 0 }), ADDRESS).activeDatum, false)
  assert.equal(evaluateBlockvase(payload('datum', { datum_work: 9, hashrate_hs: 0 }), ADDRESS).activeDatum, false)
})

test('Paperclip requires DATUM work and hashrate', () => {
  const row = (extra) => ({ stats: { window: { miners: [{ identity: ADDRESS, ...extra }] } } })
  assert.equal(evaluatePaperclip(row({ datum_work: '8', stratum_work: '0', hashrate_hs: 3 }), ADDRESS).activeDatum, true)
  assert.equal(evaluatePaperclip(row({ datum_work: '0', stratum_work: '8', hashrate_hs: 3 }), ADDRESS).activeDatum, false)
  assert.equal(evaluatePaperclip(row({ datum_work: '8', stratum_work: '0', hashrate_hs: 0 }), ADDRESS).activeDatum, false)
})

test('CONVOY online workers count only when the DATUM assumption is on', () => {
  const html = fs.readFileSync(new URL('./fixtures/convoy-online.html', import.meta.url), 'utf8')
  const parsed = parseConvoyWorkers(html, Date.parse('2026-09-28T08:50:00Z'))
  assert.equal(parsed.online, true)
  assert.equal(evaluateConvoy(parsed, { treatActiveAsDatum: true }).activeDatum, true)
  assert.equal(evaluateConvoy(parsed, { treatActiveAsDatum: false }).activeDatum, false)
  assert.equal(evaluateConvoy(parseConvoyWorkers('<p>none</p>'), { treatActiveAsDatum: true }).activeDatum, false)
})

test('B2Pool share stats never grant access', () => {
  const now = Date.parse('2026-09-28T08:00:00Z')
  const fresh = evaluateB2({ found: true, last_share_at: '2026-09-28T07:30:00Z' }, { maxAgeMs: DAY * 1000, now })
  assert.equal(fresh.ok, true)
  assert.equal(fresh.activeDatum, false)
  assert.match(fresh.detail, /cannot grant access/)
})
