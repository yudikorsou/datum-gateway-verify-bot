import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS challenges (
      discord_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      message TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS miners (
      discord_id TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      address_type TEXT NOT NULL,
      signature TEXT NOT NULL,
      verified_at INTEGER NOT NULL,
      role_granted INTEGER NOT NULL DEFAULT 0,
      last_scan_at INTEGER,
      last_scan_json TEXT
    );
  `)
  return db
}

export function saveChallenge(db, row) {
  db.prepare(`
    INSERT INTO challenges (discord_id, address, message, nonce, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      address = excluded.address,
      message = excluded.message,
      nonce = excluded.nonce,
      expires_at = excluded.expires_at
  `).run(row.discordId, row.address, row.message, row.nonce, row.expiresAt)
}

export function getChallenge(db, discordId) {
  return db.prepare(`
    SELECT discord_id AS discordId, address, message, nonce, expires_at AS expiresAt
    FROM challenges WHERE discord_id = ?
  `).get(discordId)
}

export function deleteChallenge(db, discordId) {
  db.prepare('DELETE FROM challenges WHERE discord_id = ?').run(discordId)
}

export function addressOwner(db, address) {
  return db.prepare(`
    SELECT discord_id AS discordId, address FROM miners WHERE address = ?
  `).get(address)
}

export function getMiner(db, discordId) {
  return db.prepare(`
    SELECT discord_id AS discordId, address, address_type AS addressType, signature,
           verified_at AS verifiedAt, role_granted AS roleGranted,
           last_scan_at AS lastScanAt, last_scan_json AS lastScanJson
    FROM miners WHERE discord_id = ?
  `).get(discordId)
}

export function saveMiner(db, row) {
  db.prepare(`
    INSERT INTO miners (discord_id, address, address_type, signature, verified_at, role_granted, last_scan_at, last_scan_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      address = excluded.address,
      address_type = excluded.address_type,
      signature = excluded.signature,
      verified_at = excluded.verified_at,
      role_granted = excluded.role_granted,
      last_scan_at = excluded.last_scan_at,
      last_scan_json = excluded.last_scan_json
  `).run(
    row.discordId,
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
    SELECT discord_id AS discordId, address, address_type AS addressType,
           role_granted AS roleGranted, verified_at AS verifiedAt
    FROM miners
  `).all()
}

export function deleteMiner(db, discordId) {
  db.prepare('DELETE FROM miners WHERE discord_id = ?').run(discordId)
}

export function recordScan(db, discordId, { roleGranted, scannedAt, scan }) {
  db.prepare(`
    UPDATE miners
    SET role_granted = ?, last_scan_at = ?, last_scan_json = ?
    WHERE discord_id = ?
  `).run(roleGranted ? 1 : 0, scannedAt, JSON.stringify(scan), discordId)
}
