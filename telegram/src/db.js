import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name))
}

function renameUserColumn(db, table) {
  const columns = columnNames(db, table)
  if (columns.has('discord_id') && !columns.has('telegram_id')) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN discord_id TO telegram_id`)
  }
}

function ensureColumn(db, table, name, definition) {
  if (!columnNames(db, table).has(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }
}

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS challenges (
      telegram_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      message TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      phase TEXT NOT NULL DEFAULT 'signature',
      signature TEXT
    );
    CREATE TABLE IF NOT EXISTS miners (
      telegram_id TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      address_type TEXT NOT NULL,
      signature TEXT NOT NULL,
      verified_at INTEGER NOT NULL,
      role_granted INTEGER NOT NULL DEFAULT 0,
      last_scan_at INTEGER,
      last_scan_json TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      telegram_id TEXT PRIMARY KEY,
      phase TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS join_requests (
      telegram_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      requested_at INTEGER NOT NULL
    );
  `)
  renameUserColumn(db, 'challenges')
  renameUserColumn(db, 'miners')
  ensureColumn(db, 'challenges', 'phase', `TEXT NOT NULL DEFAULT 'signature'`)
  ensureColumn(db, 'challenges', 'signature', 'TEXT')
  return db
}

export function saveSession(db, row) {
  db.prepare(`
    INSERT INTO sessions (telegram_id, phase, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      phase = excluded.phase,
      updated_at = excluded.updated_at
  `).run(row.telegramId, row.phase, row.updatedAt)
}

export function getSession(db, telegramId) {
  return db.prepare(`
    SELECT telegram_id AS telegramId, phase, updated_at AS updatedAt
    FROM sessions WHERE telegram_id = ?
  `).get(telegramId)
}

export function deleteSession(db, telegramId) {
  db.prepare('DELETE FROM sessions WHERE telegram_id = ?').run(telegramId)
}

export function saveChallenge(db, row) {
  db.prepare(`
    INSERT INTO challenges (telegram_id, address, message, nonce, expires_at, phase, signature)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      address = excluded.address,
      message = excluded.message,
      nonce = excluded.nonce,
      expires_at = excluded.expires_at,
      phase = excluded.phase,
      signature = excluded.signature
  `).run(
    row.telegramId,
    row.address,
    row.message,
    row.nonce,
    row.expiresAt,
    row.phase || 'signature',
    row.signature ?? null,
  )
}

export function getChallenge(db, telegramId) {
  return db.prepare(`
    SELECT telegram_id AS telegramId, address, message, nonce, expires_at AS expiresAt,
           phase, signature
    FROM challenges WHERE telegram_id = ?
  `).get(telegramId)
}

export function markOwnershipProven(db, telegramId, { signature, expiresAt }) {
  db.prepare(`
    UPDATE challenges
    SET phase = 'datum', signature = ?, expires_at = ?
    WHERE telegram_id = ?
  `).run(signature, expiresAt, telegramId)
}

export function deleteChallenge(db, telegramId) {
  db.prepare('DELETE FROM challenges WHERE telegram_id = ?').run(telegramId)
}

export function addressOwner(db, address) {
  return db.prepare(`
    SELECT telegram_id AS telegramId, address FROM miners WHERE address = ?
  `).get(address)
}

export function getMiner(db, telegramId) {
  return db.prepare(`
    SELECT telegram_id AS telegramId, address, address_type AS addressType, signature,
           verified_at AS verifiedAt, role_granted AS roleGranted,
           last_scan_at AS lastScanAt, last_scan_json AS lastScanJson
    FROM miners WHERE telegram_id = ?
  `).get(telegramId)
}

export function saveMiner(db, row) {
  db.prepare(`
    INSERT INTO miners (telegram_id, address, address_type, signature, verified_at, role_granted, last_scan_at, last_scan_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      address = excluded.address,
      address_type = excluded.address_type,
      signature = excluded.signature,
      verified_at = excluded.verified_at,
      role_granted = excluded.role_granted,
      last_scan_at = excluded.last_scan_at,
      last_scan_json = excluded.last_scan_json
  `).run(
    row.telegramId,
    row.address,
    row.addressType,
    row.signature,
    row.verifiedAt,
    row.roleGranted ? 1 : 0,
    row.lastScanAt ?? null,
    row.lastScanJson ?? null,
  )
}

export function listMiners(db) {
  return db.prepare(`
    SELECT telegram_id AS telegramId, address, address_type AS addressType,
           role_granted AS roleGranted, verified_at AS verifiedAt
    FROM miners
  `).all()
}

export function deleteMiner(db, telegramId) {
  db.prepare('DELETE FROM miners WHERE telegram_id = ?').run(telegramId)
}

export function recordScan(db, telegramId, { roleGranted, scannedAt, scan }) {
  db.prepare(`
    UPDATE miners
    SET role_granted = ?, last_scan_at = ?, last_scan_json = ?
    WHERE telegram_id = ?
  `).run(roleGranted ? 1 : 0, scannedAt, JSON.stringify(scan), telegramId)
}

export function saveJoinRequest(db, row) {
  db.prepare(`
    INSERT INTO join_requests (telegram_id, chat_id, requested_at)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      chat_id = excluded.chat_id,
      requested_at = excluded.requested_at
  `).run(row.telegramId, row.chatId, row.requestedAt)
}

export function getJoinRequest(db, telegramId) {
  return db.prepare(`
    SELECT telegram_id AS telegramId, chat_id AS chatId, requested_at AS requestedAt
    FROM join_requests WHERE telegram_id = ?
  `).get(telegramId)
}

export function deleteJoinRequest(db, telegramId) {
  db.prepare('DELETE FROM join_requests WHERE telegram_id = ?').run(telegramId)
}
