import { sameAddress } from '../address.js'

export function positiveWork(value) {
  if (value === null || value === undefined || value === '') return false
  try {
    return BigInt(value) > 0n
  } catch {
    const number = Number(value)
    return Number.isFinite(number) && number > 0
  }
}

export function positiveHashrate(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0
}

function miss(id, name, detail) {
  return { id, name, ok: true, activeDatum: false, detail }
}

function hit(id, name, detail) {
  return { id, name, ok: true, activeDatum: true, detail }
}

function down(id, name, error) {
  return { id, name, ok: false, activeDatum: false, detail: error.message || String(error) }
}

export function evaluateLazarus(payload, address, { maxAgeSec }) {
  const id = 'lazarus'
  const name = 'Lazarus Pool'
  if (!payload || payload.known === false) {
    return miss(id, name, 'Address is not in the pool miner list.')
  }
  const workers = Array.isArray(payload.workers) ? payload.workers : []
  const fresh = workers.filter((worker) => {
    const fee = String(worker.fee_path || '').toLowerCase()
    const via = String(worker.via || '').toLowerCase()
    const datum = fee === 'datum' || via === 'prime'
    const age = Number(worker.last_share_s)
    return datum && Number.isFinite(age) && age >= 0 && age <= maxAgeSec
  })
  if (!fresh.length) {
    const stratum = workers.some((worker) => {
      const via = String(worker.via || '').toLowerCase()
      const fee = String(worker.fee_path || '').toLowerCase()
      return via === 'stratum' && fee !== 'datum'
    })
    return miss(
      id,
      name,
      stratum
        ? 'The address is on the public stratum, not a DATUM Gateway.'
        : 'No fresh DATUM Gateway share from this address.',
    )
  }
  fresh.sort((a, b) => Number(a.last_share_s) - Number(b.last_share_s))
  const best = fresh[0]
  const gateway = best.gateway_name ? ` via ${best.gateway_name}` : ''
  return hit(id, name, `DATUM share ${Math.round(Number(best.last_share_s))}s ago${gateway}.`)
}

export function evaluateOmega(snapshot, address) {
  const id = 'omega'
  const name = 'OmegaPool'
  const miners = snapshot?.window?.miners
  if (!Array.isArray(miners)) return down(id, name, new Error('OmegaPool snapshot has no miner window.'))
  const row = miners.find((miner) => sameAddress(miner.identity, address))
  if (!row) return miss(id, name, 'Address is not in the current payout window.')
  if (positiveWork(row.own_gateway_work) && positiveHashrate(row.hashrate_hs)) {
    return hit(id, name, 'Own DATUM gateway hashrate is live in the payout window.')
  }
  if (positiveHashrate(row.hashrate_hs) && !positiveWork(row.own_gateway_work)) {
    return miss(id, name, 'Hashrate is on the public gateway, not the miner’s own DATUM gateway.')
  }
  return miss(id, name, 'Own-gateway work is in the window, but hashrate is zero.')
}

export function evaluateRiptide(payload, address) {
  const id = 'riptide'
  const name = 'RIPTide'
  if (!payload || payload.missing) return miss(id, name, 'Address has no RIPTide snapshot.')
  if (payload.address && !sameAddress(payload.address, address)) {
    return miss(id, name, 'RIPTide returned a different address.')
  }
  const workers = Array.isArray(payload.worker_breakdown) ? payload.worker_breakdown : []
  const live = workers.filter((worker) => String(worker.connection_type || '').toLowerCase() === 'datum' && positiveHashrate(worker.hashrate_hs))
  if (!live.length) {
    const sv1 = workers.some((worker) => String(worker.connection_type || '').toLowerCase() === 'sv1' && positiveHashrate(worker.hashrate_hs))
    return miss(
      id,
      name,
      sv1 ? 'Live hashrate is Stratum V1, not DATUM.' : 'No live DATUM worker hashrate.',
    )
  }
  return hit(id, name, `${live.length} DATUM worker${live.length === 1 ? '' : 's'} with live hashrate.`)
}

export function evaluateBlockvase(payload, address) {
  const id = 'blockvase'
  const name = 'Blockvase'
  const miners = payload?.miners
  if (!Array.isArray(miners)) return down(id, name, new Error('Blockvase pool snapshot has no miners.'))
  const row = miners.find((miner) => sameAddress(miner.id, address))
  if (!row) return miss(id, name, 'Address is not in the Blockvase window.')
  const kind = String(row.kind || '').toLowerCase()
  const datum = kind === 'datum' || (kind === 'mixed' && positiveWork(row.datum_work))
  if (datum && positiveHashrate(row.hashrate_hs)) {
    return hit(id, name, `DATUM path (${kind}) has live hashrate.`)
  }
  if (kind === 'sv1') return miss(id, name, 'Address is on public Stratum V1, not DATUM.')
  return miss(id, name, 'DATUM work is not paired with live hashrate.')
}

export function evaluatePaperclip(payload, address) {
  const id = 'paperclip'
  const name = 'Paperclip Pool'
  const miners = payload?.stats?.window?.miners
  if (!Array.isArray(miners)) return down(id, name, new Error('Paperclip status has no miner window.'))
  const row = miners.find((miner) => sameAddress(miner.identity, address))
  if (!row) return miss(id, name, 'Address is not in the Paperclip TIDES window.')
  if (positiveWork(row.datum_work) && positiveHashrate(row.hashrate_hs)) {
    return hit(id, name, 'DATUM work and live hashrate are both in the window.')
  }
  if (positiveWork(row.stratum_work) && !positiveWork(row.datum_work)) {
    return miss(id, name, 'Window work is public Stratum, not DATUM.')
  }
  return miss(id, name, 'DATUM work is in the window, but hashrate is zero.')
}

export function parseConvoyWorkers(html, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000) {
  const rows = html.match(/<tr class="table-row">[\s\S]*?<\/tr>/g) || []
  let newest = null
  let online = false
  for (const row of rows) {
    if (row.includes('status-online-text')) online = true
    const stamp = row.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)
    if (!stamp) continue
    const at = Date.parse(`${stamp[1].replace(' ', 'T')}:00Z`)
    if (!Number.isFinite(at)) continue
    if (newest === null || at > newest) newest = at
  }
  const recent = newest !== null && now - newest <= maxAgeMs && now - newest >= -5 * 60 * 1000
  return { online, recent, newest }
}

export function evaluateConvoy(parsed, { treatActiveAsDatum }) {
  const id = 'convoy'
  const name = 'CONVOY'
  const active = parsed.online || parsed.recent
  if (!active) return miss(id, name, 'No online worker and no share timestamp inside the freshness window.')
  if (!treatActiveAsDatum) {
    return {
      id,
      name,
      ok: true,
      activeDatum: false,
      detail: 'A worker is active, but CONVOY_TREAT_ACTIVE_AS_DATUM is off, so this pool cannot grant access. CONVOY does not print a DATUM flag on the worker table.',
    }
  }
  const how = parsed.online ? 'Worker is online' : 'Last worker timestamp is inside the freshness window'
  return hit(
    id,
    name,
    `${how}. CONVOY’s published connect path is a DATUM Gateway; the public worker table does not print a separate DATUM flag.`,
  )
}

export function evaluateB2(payload, { maxAgeMs, now = Date.now() }) {
  const id = 'b2pool'
  const name = 'B2Pool'
  if (!payload || payload.found === false) return miss(id, name, 'Address is not a known B2Pool miner.')
  const at = Date.parse(payload.last_share_at || '')
  const fresh = Number.isFinite(at) && now - at <= maxAgeMs && now - at >= -5 * 60 * 1000
  if (!fresh) return miss(id, name, 'No B2Pool share inside the freshness window.')
  return {
    id,
    name,
    ok: true,
    activeDatum: false,
    detail: `Last share ${payload.last_share_at}. B2Pool publishes miner stats, but not whether the share arrived from a DATUM Gateway or from public stratum, so it cannot grant access.`,
  }
}

export { down }
