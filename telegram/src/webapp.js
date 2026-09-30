const DEFAULT_WEBAPP_URL = 'https://yudikorsou.github.io/datum-gateway-telegram-verify-bot/'
const VERIFY_APP_VERSION = 'bip322'
const VERIFY_APP_LABEL = 'Open DATUM verification'

export function normalizeWebAppUrl(value) {
  const raw = String(value || DEFAULT_WEBAPP_URL).trim()
  if (!raw) return DEFAULT_WEBAPP_URL
  return raw.endsWith('/') ? raw : `${raw}/`
}

export function verifyAppUrl(base, telegramId) {
  const url = new URL(normalizeWebAppUrl(base))
  url.searchParams.set('v', VERIFY_APP_VERSION)
  if (telegramId) url.searchParams.set('uid', String(telegramId))
  return url.toString()
}

export function addressFormUrl(base, telegramId) {
  return verifyAppUrl(base, telegramId)
}

export function signatureFormUrl(base, telegramId) {
  return verifyAppUrl(base, telegramId)
}

export function webAppKeyboard(url, label) {
  return {
    inline_keyboard: [[{ text: label, web_app: { url } }]],
  }
}

export function webAppReplyKeyboard(url, label) {
  return {
    keyboard: [[{ text: label, web_app: { url } }]],
    resize_keyboard: true,
    one_time_keyboard: false,
    is_persistent: true,
  }
}

export function removeWebAppKeyboard() {
  return { remove_keyboard: true }
}

export function verifyAppMarkup(config, telegramId) {
  if (!config?.webAppUrl) return { force_reply: true, selective: true }
  return webAppKeyboard(verifyAppUrl(config.webAppUrl, telegramId), VERIFY_APP_LABEL)
}

export function verifyAppReplyMarkup(config, telegramId) {
  if (!config?.webAppUrl) return null
  return webAppReplyKeyboard(verifyAppUrl(config.webAppUrl, telegramId), VERIFY_APP_LABEL)
}

export function addressFormMarkup(config, telegramId) {
  return verifyAppMarkup(config, telegramId)
}

export function signatureFormMarkup(config, telegramId) {
  return verifyAppMarkup(config, telegramId)
}

export function parseWebAppData(raw) {
  try {
    const data = JSON.parse(raw)
    if (data?.type === 'proof' && data.address && data.signature && data.nonce && data.issued) {
      return {
        type: 'proof',
        address: String(data.address).trim(),
        signature: String(data.signature).trim(),
        nonce: String(data.nonce).trim(),
        issued: String(data.issued).trim(),
      }
    }
    if (data?.type === 'address' && data.address) {
      return { type: 'address', address: String(data.address).trim() }
    }
    if (data?.type === 'signature' && data.signature) {
      return { type: 'signature', signature: String(data.signature).trim() }
    }
  } catch {
    return null
  }
  return null
}
