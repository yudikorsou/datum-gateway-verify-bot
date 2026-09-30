const USER_AGENT = 'DATUMGatewayVerifyBot/1.0 (+https://github.com/luke-jr/datum_gateway)'

export async function fetchText(url, { timeoutMs = 20_000 } = {}) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json, text/html;q=0.9, */*;q=0.8',
      'user-agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.text()
  return { status: response.status, ok: response.ok, body }
}

export async function fetchJson(url, options) {
  const result = await fetchText(url, options)
  if (!result.ok) {
    const error = new Error(`HTTP ${result.status} for ${url}`)
    error.status = result.status
    error.body = result.body.slice(0, 300)
    throw error
  }
  try {
    return JSON.parse(result.body)
  } catch {
    const error = new Error(`Pool did not return JSON for ${url}`)
    error.status = result.status
    throw error
  }
}
