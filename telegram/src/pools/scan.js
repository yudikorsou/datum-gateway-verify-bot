import { fetchJson, fetchText } from '../http.js'
import {
  down,
  evaluateB2,
  evaluateBlockvase,
  evaluateConvoy,
  evaluateLazarus,
  evaluateOmega,
  evaluatePaperclip,
  evaluateRiptide,
  parseConvoyWorkers,
} from './evaluate.js'

const LAZARUS = 'https://pool.lazarus-xbt.xyz'
const OMEGA = 'https://omegapool.tech/stats.json'
const RIPTIDE = 'https://riptide.maveth.ca'
const BLOCKVASE = 'https://blockvase.com/api/pool'
const PAPERCLIP = 'https://pool.paperclippool.xyz/api/status'
const CONVOY = 'https://convoy.xyz'
const B2 = 'https://b2pool.io'

async function safe(id, name, run) {
  try {
    return await run()
  } catch (error) {
    return down(id, name, error)
  }
}

async function loadOne(id, name, url) {
  try {
    return { ok: true, data: await fetchJson(url) }
  } catch (error) {
    return { ok: false, result: down(id, name, error) }
  }
}

export async function loadSharedSnapshots() {
  const [omega, blockvase, paperclip] = await Promise.all([
    loadOne('omega', 'OmegaPool', OMEGA),
    loadOne('blockvase', 'Blockvase', BLOCKVASE),
    loadOne('paperclip', 'Paperclip Pool', PAPERCLIP),
  ])
  return { omega, blockvase, paperclip }
}

function useSnapshot(snapshot, address, evaluate) {
  if (!snapshot.ok) return snapshot.result
  return evaluate(snapshot.data, address)
}

export async function scanAddress(address, options, shared = null) {
  const maxAgeMs = options.shareMaxAgeHours * 60 * 60 * 1000
  const maxAgeSec = options.shareMaxAgeHours * 60 * 60
  const snapshots = shared || await loadSharedSnapshots()

  const [lazarus, riptide, convoy, b2] = await Promise.all([
    safe('lazarus', 'Lazarus Pool', async () => {
      const payload = await fetchJson(`${LAZARUS}/api/miner/${encodeURIComponent(address)}`)
      return evaluateLazarus(payload, address, { maxAgeSec })
    }),
    safe('riptide', 'RIPTide', async () => {
      const response = await fetchText(`${RIPTIDE}/api/user/${encodeURIComponent(address)}`)
      if (response.status === 404) return evaluateRiptide({ missing: true }, address)
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for RIPTide`), { status: response.status })
      return evaluateRiptide(JSON.parse(response.body), address)
    }),
    safe('convoy', 'CONVOY', async () => {
      const response = await fetchText(`${CONVOY}/template/workers/rows?user=${encodeURIComponent(address)}`)
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for CONVOY`), { status: response.status })
      const parsed = parseConvoyWorkers(response.body, Date.now(), maxAgeMs)
      return evaluateConvoy(parsed, { treatActiveAsDatum: options.convoyTreatActiveAsDatum })
    }),
    safe('b2pool', 'B2Pool', async () => {
      const response = await fetchText(`${B2}/api/v1/miner/${encodeURIComponent(address)}?hours=24`)
      if (response.status === 404) return evaluateB2({ found: false }, { maxAgeMs })
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for B2Pool`), { status: response.status })
      return evaluateB2(JSON.parse(response.body), { maxAgeMs })
    }),
  ])

  const omega = useSnapshot(snapshots.omega, address, evaluateOmega)
  const blockvase = useSnapshot(snapshots.blockvase, address, evaluateBlockvase)
  const paperclip = useSnapshot(snapshots.paperclip, address, evaluatePaperclip)

  const results = [convoy, omega, riptide, lazarus, blockvase, paperclip, b2].filter(Boolean)
  return {
    results,
    activeDatum: results.some((result) => result.activeDatum),
    conclusive: results.every((result) => result.ok),
  }
}

export function summarizeScan(scan) {
  return scan.results.map((result) => {
    const mark = !result.ok ? 'unreachable' : result.activeDatum ? 'DATUM shares' : 'no DATUM shares'
    return `${result.name}: ${mark}. ${result.detail}`
  })
}
