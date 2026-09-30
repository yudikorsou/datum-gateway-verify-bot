import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import ffmpegPath from 'ffmpeg-static'

const root = path.dirname(fileURLToPath(import.meta.url))
const audioDir = path.join(root, 'audio')
const frameDir = path.join(root, 'frames')
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const fps = 12
const pad = 0.55
const edge = [
  path.join(root, '.venv/bin/edge-tts'),
  path.resolve(root, '../../../datum-gateway-verify-bot/docs/signature-explainer/.venv/bin/edge-tts'),
].find((file) => fs.existsSync(file))
const narrator = 'en-US-AvaNeural'

const scenes = [
  {
    id: 'miniapp',
    view: 'miniapp',
    title: 'Telegram form',
    caption: 'Copy the exact sign text from this window. Do not change a line.',
    say: 'This Telegram window is where you prove the wallet. First, copy the sign text exactly. Keep every line break, the Telegram user number, the nonce, and the timestamp.',
  },
  {
    id: 'sparrow',
    view: 'sparrow',
    title: 'Sparrow or Shrike',
    caption: 'Tools → Sign/Verify Message. Paste the text, match the address, choose Electrum or BIP137, then Sign.',
    say: 'Open Sparrow, or Shrike if you use the Blake two B wallet. They share the same Sign and Verify Message screen. Click Tools, then Sign or Verify Message. Paste the full text from Telegram into the Message box, and check that the address matches. For this B C one Q address, choose Standard Electrum, or B.I.P. one thirty-seven. Then click Sign, and copy the signature. This is a message signature. The sigh-hash unified flag is only for spending coins, so you don’t use it here.',
  },
  {
    id: 'paste',
    view: 'paste',
    title: 'Paste the signature',
    caption: 'Back in Telegram, paste the wallet signature into the field, then submit.',
    say: 'Come back to the Telegram window. Paste that signature into the field under the sign text, then tap Submit signature. The bot checks that this key signed this exact message.',
  },
  {
    id: 'format',
    view: 'format',
    title: 'Which signature format',
    caption: 'bc1q uses a classic signed message. bc1p Taproot uses BIP322.',
    say: 'One last detail. Addresses that start with B C one P are Taproot, and they need a B.I.P. three twenty-two signature. Legacy addresses and SegWit addresses, including this B C one Q address, use the classic Bitcoin signed message. Sign the text exactly as the form shows it, then paste that signature in Telegram.',
  },
]

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
}

function durationOf(file) {
  const result = spawnSync('afinfo', [file], { encoding: 'utf8' })
  const line = result.stdout.split('\n').find((row) => row.includes('estimated duration'))
  const seconds = Number(line.match(/([\d.]+)\s*sec/)?.[1])
  if (!Number.isFinite(seconds)) throw new Error(`Could not read duration of ${file}`)
  return seconds
}

if (!edge) throw new Error('edge-tts is missing. Create docs/signature-explainer/.venv and install edge-tts.')

fs.rmSync(audioDir, { recursive: true, force: true })
fs.rmSync(frameDir, { recursive: true, force: true })
fs.mkdirSync(audioDir, { recursive: true })
fs.mkdirSync(frameDir, { recursive: true })

const wavs = []
let cursor = 0
const timed = []
for (const scene of scenes) {
  const mp3 = path.join(audioDir, `${scene.id}.mp3`)
  const wav = path.join(audioDir, `${scene.id}.wav`)
  run(edge, ['--voice', narrator, '--rate=-8%', '--text', scene.say, '--write-media', mp3])
  run(ffmpegPath, ['-y', '-i', mp3, '-af', `apad=pad_dur=${pad}`, wav])
  const seconds = durationOf(wav)
  timed.push({ ...scene, start: cursor, end: cursor + seconds })
  cursor += seconds
  wavs.push(wav)
}

const timing = {
  total: cursor,
  scenes: timed.map(({ id, view, title, caption, start, end }) => ({ id, view, title, caption, start, end })),
}
fs.writeFileSync(path.join(root, 'timing.json'), JSON.stringify(timing, null, 2))

const list = path.join(audioDir, 'list.txt')
fs.writeFileSync(list, wavs.map((file) => `file '${file}'`).join('\n'))
const voice = path.join(root, 'voice.m4a')
run(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'aac', '-b:a', '160k', voice])

const frames = Math.ceil(timing.total * fps)
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ['--hide-scrollbars', '--disable-gpu'],
})
const page = await browser.newPage()
await page.goto(`file://${path.join(root, 'index.html')}`, { waitUntil: 'load' })
for (let i = 0; i < frames; i++) {
  const t = i / fps
  await page.evaluate((time, data) => window.renderAt(time, data), t, timing)
  const file = path.join(frameDir, `${String(i).padStart(5, '0')}.jpg`)
  await page.screenshot({ path: file, type: 'jpeg', quality: 78 })
  if (i % 24 === 0) console.log(`frame ${i + 1}/${frames}`)
}
await browser.close()

const video = path.join(root, 'sign-the-message.mp4')
run(ffmpegPath, [
  '-y',
  '-framerate', String(fps),
  '-i', path.join(frameDir, '%05d.jpg'),
  '-i', voice,
  '-c:v', 'libx264',
  '-profile:v', 'main',
  '-level', '4.0',
  '-pix_fmt', 'yuv420p',
  '-r', '30',
  '-c:a', 'aac',
  '-ar', '44100',
  '-ac', '2',
  '-b:a', '128k',
  '-shortest',
  '-movflags', '+faststart',
  video,
])

const webapp = path.resolve(root, '../../webapp/sign-the-message.mp4')
fs.copyFileSync(video, webapp)
console.log(`wrote ${video} and ${webapp} (${timing.total.toFixed(1)}s)`)
