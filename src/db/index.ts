import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { config } from '../config.js'
import type {
  ActivityEntry,
  AuthTokens,
  CardContent,
  SkipProfile
} from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export class AppDatabase {
  private db: Database.Database

  constructor(dbPath = config.dbPath) {
    this.db = new Database(dbPath)
    const schemaPath = [join(__dirname, 'schema.sql'), join(process.cwd(), 'src/db/schema.sql')].find((path) =>
      existsSync(path)
    )
    if (!schemaPath) {
      throw new Error('Could not locate db/schema.sql')
    }
    const schema = readFileSync(schemaPath, 'utf8')
    this.db.exec(schema)
  }

  getAuthTokens(): AuthTokens | null {
    const row = this.db
      .prepare('SELECT access_token, refresh_token, expires_at FROM auth_tokens WHERE id = 1')
      .get() as { access_token: string; refresh_token: string; expires_at: string } | undefined
    if (!row) return null
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at
    }
  }

  saveAuthTokens(tokens: AuthTokens): void {
    this.db
      .prepare(
        `INSERT INTO auth_tokens (id, access_token, refresh_token, expires_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at`
      )
      .run(tokens.accessToken, tokens.refreshToken, tokens.expiresAt)
  }

  clearAuthTokens(): void {
    this.db.prepare('DELETE FROM auth_tokens WHERE id = 1').run()
  }

  listProfiles(): SkipProfile[] {
    const rows = this.db
      .prepare('SELECT * FROM skip_profiles ORDER BY card_title COLLATE NOCASE')
      .all() as Array<{
      id: string
      card_id: string
      card_title: string
      enabled: number
      skip_track_keys: string
      created_at: string
      updated_at: string
    }>
    return rows.map(rowToProfile)
  }

  getProfile(cardId: string): SkipProfile | null {
    const row = this.db
      .prepare('SELECT * FROM skip_profiles WHERE card_id = ?')
      .get(cardId) as
      | {
          id: string
          card_id: string
          card_title: string
          enabled: number
          skip_track_keys: string
          created_at: string
          updated_at: string
        }
      | undefined
    return row ? rowToProfile(row) : null
  }

  upsertProfile(input: {
    cardId: string
    cardTitle: string
    skipTrackKeys: string[]
    enabled?: boolean
  }): SkipProfile {
    const existing = this.getProfile(input.cardId)
    const now = new Date().toISOString()
    if (existing) {
      this.db
        .prepare(
          `UPDATE skip_profiles SET
             card_title = ?,
             skip_track_keys = ?,
             enabled = ?,
             updated_at = ?
           WHERE card_id = ?`
        )
        .run(
          input.cardTitle,
          JSON.stringify(input.skipTrackKeys),
          input.enabled === undefined ? (existing.enabled ? 1 : 0) : input.enabled ? 1 : 0,
          now,
          input.cardId
        )
      return this.getProfile(input.cardId)!
    }

    const profile: SkipProfile = {
      id: randomUUID(),
      cardId: input.cardId,
      cardTitle: input.cardTitle,
      enabled: input.enabled ?? true,
      skipTrackKeys: input.skipTrackKeys,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO skip_profiles (id, card_id, card_title, enabled, skip_track_keys, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile.id,
        profile.cardId,
        profile.cardTitle,
        profile.enabled ? 1 : 0,
        JSON.stringify(profile.skipTrackKeys),
        profile.createdAt,
        profile.updatedAt
      )
    return profile
  }

  setProfileEnabled(cardId: string, enabled: boolean): SkipProfile | null {
    const existing = this.getProfile(cardId)
    if (!existing) return null
    const now = new Date().toISOString()
    this.db.prepare('UPDATE skip_profiles SET enabled = ?, updated_at = ? WHERE card_id = ?').run(enabled ? 1 : 0, now, cardId)
    return this.getProfile(cardId)
  }

  deleteProfile(cardId: string): boolean {
    const result = this.db.prepare('DELETE FROM skip_profiles WHERE card_id = ?').run(cardId)
    return result.changes > 0
  }

  getCachedCard(cardId: string): CardContent | null {
    const row = this.db
      .prepare('SELECT content_json FROM card_cache WHERE card_id = ?')
      .get(cardId) as { content_json: string } | undefined
    if (!row) return null
    return JSON.parse(row.content_json) as CardContent
  }

  getCachedCardFetchedAt(cardId: string): string | null {
    const row = this.db
      .prepare('SELECT fetched_at FROM card_cache WHERE card_id = ?')
      .get(cardId) as { fetched_at: string } | undefined
    return row?.fetched_at ?? null
  }

  cacheCard(content: CardContent): void {
    this.db
      .prepare(
        `INSERT INTO card_cache (card_id, content_json, fetched_at)
         VALUES (?, ?, ?)
         ON CONFLICT(card_id) DO UPDATE SET
           content_json = excluded.content_json,
           fetched_at = excluded.fetched_at`
      )
      .run(content.cardId, JSON.stringify(content), new Date().toISOString())
  }

  isCardCacheFresh(cardId: string, ttlMs: number): boolean {
    const fetchedAt = this.getCachedCardFetchedAt(cardId)
    if (!fetchedAt) return false
    return Date.now() - new Date(fetchedAt).getTime() < ttlMs
  }

  addActivity(entry: Omit<ActivityEntry, 'id'>): ActivityEntry {
    const record: ActivityEntry = { id: randomUUID(), ...entry }
    this.db
      .prepare(
        `INSERT INTO activity_log (
           id, timestamp, device_id, device_name, card_id, card_title,
           skipped_track_key, skipped_track_title, jumped_to_track_key, jumped_to_track_title
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.timestamp,
        record.deviceId,
        record.deviceName,
        record.cardId,
        record.cardTitle,
        record.skippedTrackKey,
        record.skippedTrackTitle,
        record.jumpedToTrackKey,
        record.jumpedToTrackTitle
      )
    this.trimActivityLog(200)
    return record
  }

  listActivity(limit = 50): ActivityEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as Array<{
      id: string
      timestamp: string
      device_id: string
      device_name: string
      card_id: string
      card_title: string
      skipped_track_key: string
      skipped_track_title: string
      jumped_to_track_key: string
      jumped_to_track_title: string
    }>
    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      deviceId: row.device_id,
      deviceName: row.device_name,
      cardId: row.card_id,
      cardTitle: row.card_title,
      skippedTrackKey: row.skipped_track_key,
      skippedTrackTitle: row.skipped_track_title,
      jumpedToTrackKey: row.jumped_to_track_key,
      jumpedToTrackTitle: row.jumped_to_track_title
    }))
  }

  private trimActivityLog(maxRows: number): void {
    this.db
      .prepare(
        `DELETE FROM activity_log WHERE id NOT IN (
           SELECT id FROM activity_log ORDER BY timestamp DESC LIMIT ?
         )`
      )
      .run(maxRows)
  }

  close(): void {
    this.db.close()
  }
}

function rowToProfile(row: {
  id: string
  card_id: string
  card_title: string
  enabled: number
  skip_track_keys: string
  created_at: string
  updated_at: string
}): SkipProfile {
  return {
    id: row.id,
    cardId: row.card_id,
    cardTitle: row.card_title,
    enabled: row.enabled === 1,
    skipTrackKeys: JSON.parse(row.skip_track_keys) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

let dbInstance: AppDatabase | null = null

export function getDb(): AppDatabase {
  if (!dbInstance) {
    dbInstance = new AppDatabase()
  }
  return dbInstance
}

/** @internal Reset singleton for tests */
export function resetDbForTests(db?: AppDatabase): void {
  if (dbInstance && dbInstance !== db) {
    dbInstance.close()
  }
  dbInstance = db ?? null
}
