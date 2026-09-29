import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AttachmentBuilder } from 'discord.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export function explainerVideoPath() {
  const candidates = [
    path.resolve(here, '../assets/prove-your-address.mp4'),
    path.resolve(here, '../docs/signature-explainer/prove-your-address.mp4'),
    path.resolve(process.cwd(), 'assets/prove-your-address.mp4'),
    path.resolve(process.cwd(), 'docs/signature-explainer/prove-your-address.mp4'),
  ]
  return candidates.find((file) => fs.existsSync(file)) || null
}

export function explainerFiles() {
  const file = explainerVideoPath()
  if (!file) return []
  return [new AttachmentBuilder(file, { name: 'prove-your-address.mp4' })]
}
