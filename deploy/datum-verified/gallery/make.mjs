import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const ROOT = path.resolve(import.meta.dirname, '..')
const WEB = path.join(ROOT, 'web')
const OUT = process.argv[2] || path.join(ROOT, 'gallery')
const PORT = 3848
const VIEW_W = 1280
const VIEW_H = 800
const FINAL_W = 1440
const FINAL_H = 900

const DEMO = {
  settings: {
    DISCORD_ENABLED: '1',
    DISCORD_TOKEN: '••••saved',
    DISCORD_CLIENT_ID: '109876543210987654',
    DISCORD_GUILD_ID: '108765432109876543',
    VERIFIED_ROLE_ID: '107654321098765432',
    TELEGRAM_ENABLED: '1',
    TELEGRAM_BOT_TOKEN: '••••saved',
    TELEGRAM_CHAT_ID: '-1001987654321',
    WEBAPP_URL: 'https://yudikorsou.github.io/datum-gateway-verify-bot/',
    SCAN_INTERVAL_HOURS: '24',
    SHARE_MAX_AGE_HOURS: '24',
    CONVOY_TREAT_ACTIVE_AS_DATUM: 'true',
    discordTokenSet: true,
    telegramTokenSet: true,
    discordInviteUrl:
      'https://discord.com/oauth2/authorize?client_id=109876543210987654&permissions=2415996096&integration_type=0&scope=bot+applications.commands',
  },
  discord: { ok: true, detail: 'Logged in as DATUM Gateway' },
  telegram: { ok: true, detail: 'Logged in as @datumgatewaybot' },
}

const shots = [
  {
    file: 'gallery-1.png',
    headline: 'Verify DATUM Gateway miners in your own Discord and Telegram.',
    originKey: 'top',
  },
  {
    file: 'gallery-2.png',
    headline: 'Paste bot tokens in the browser. No SSH required.',
    originKey: 'telegram',
  },
  {
    file: 'gallery-3.png',
    headline: 'Recheck DATUM shares every 24 hours on your Umbrel.',
    originKey: 'scan',
  },
]

function frameHtml(headline, shotDataUrl) {
  const safe = headline.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${FINAL_W}px; height: ${FINAL_H}px; overflow: hidden; }
  body {
    font-family: "SF Pro Display", "Helvetica Neue", ui-sans-serif, sans-serif;
    background:
      radial-gradient(900px 420px at 12% 0%, rgba(245,166,35,0.18), transparent 55%),
      radial-gradient(700px 380px at 90% 100%, rgba(88,101,242,0.18), transparent 50%),
      linear-gradient(160deg, #10141c 0%, #0b0d12 55%, #121826 100%);
    color: white;
  }
  h1 {
    margin: 0;
    padding: 42px 56px 0;
    font-size: 34px;
    line-height: 1.2;
    letter-spacing: -0.03em;
    font-weight: 750;
    text-align: center;
    text-wrap: balance;
  }
  .window {
    width: 1180px;
    height: 700px;
    margin: 28px auto 0;
    border-radius: 18px;
    overflow: hidden;
    box-shadow: 0 28px 70px rgba(0,0,0,0.45);
    background: #0b0d12;
    border: 1px solid rgba(255,255,255,0.08);
  }
  .chrome {
    height: 40px;
    background: #1a2030;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .url {
    flex: 1;
    margin: 0 36px 0 18px;
    height: 24px;
    border-radius: 7px;
    background: #0d1118;
    color: #93a0b5;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
  }
  .screen {
    width: 1180px;
    height: 660px;
    object-fit: cover;
    object-position: top center;
    display: block;
  }
</style>
</head>
<body>
  <h1>${safe}</h1>
  <div class="window">
    <div class="chrome">
      <span class="dot" style="background:#ff5f57"></span>
      <span class="dot" style="background:#febc2e"></span>
      <span class="dot" style="background:#28c840"></span>
      <div class="url">umbrel.local · DATUM Verified</div>
    </div>
    <img class="screen" src="${shotDataUrl}" alt="">
  </div>
</body>
</html>`
}

fs.mkdirSync(OUT, { recursive: true })

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: WEB,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: '/tmp/datum-verified-gallery-data' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (chunk) => process.stdout.write(chunk))
child.stderr.on('data', (chunk) => process.stderr.write(chunk))
await sleep(700)

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
const app = await browser.newPage({
  viewport: { width: VIEW_W, height: VIEW_H },
  deviceScaleFactor: 2,
})
await app.route('**/api/status', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(DEMO),
  })
})
await app.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await sleep(400)
await app.evaluate(() => window.scrollTo(0, 0))

const offsets = await app.evaluate(() => {
  const byHeading = (text) => {
    const heading = [...document.querySelectorAll('h2')].find((node) => node.textContent.trim() === text)
    const section = heading?.closest('section')
    return Math.round((section?.getBoundingClientRect().top || 0) + window.scrollY)
  }
  return {
    top: 0,
    telegram: byHeading('Telegram'),
    scan: byHeading('Scan'),
    height: document.documentElement.scrollHeight,
  }
})
console.log('offsets', offsets)

async function cropFrom(yCss) {
  const clipY = Math.max(0, Math.min(yCss, Math.max(0, offsets.height - VIEW_H)))
  await app.evaluate((y) => window.scrollTo(0, y), clipY)
  await sleep(200)
  return app.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width: VIEW_W, height: VIEW_H },
  })
}

const frame = await browser.newPage({
  viewport: { width: FINAL_W, height: FINAL_H },
  deviceScaleFactor: 1,
})

for (const shot of shots) {
  const png = await cropFrom(offsets[shot.originKey])
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  await frame.setContent(frameHtml(shot.headline, dataUrl), { waitUntil: 'load' })
  await sleep(150)
  const dest = path.join(OUT, shot.file)
  await frame.screenshot({ path: dest, type: 'png' })
  // Umbrel-style numbered aliases
  await frame.screenshot({ path: path.join(OUT, shot.file.replace('gallery-', '')), type: 'png' })
  console.log(dest, shot.originKey, offsets[shot.originKey])
}

await browser.close()
child.kill('SIGTERM')
