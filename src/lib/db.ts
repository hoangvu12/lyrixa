import type { LookupKey, LyricsRecord, LyricsType, TrackForLyrics } from "../types";
import { now, ttlForFallbackType, ttlForType } from "./time";

export async function findLyricsByKeys(db: D1Database, keys: LookupKey[]): Promise<LyricsRecord | null> {
  if (keys.length === 0) return null;
  const placeholders = keys.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT l.* FROM lyrics_keys k JOIN lyrics l ON l.id = k.lyrics_id WHERE k.key IN (${placeholders}) ORDER BY l.found DESC, l.confidence DESC LIMIT 1`
  ).bind(...keys.map((item) => item.key)).first<LyricsRecord>();
  return result ?? null;
}

export async function findLyricsByKeysForTrack(db: D1Database, track: TrackForLyrics, keys: LookupKey[]): Promise<LyricsRecord | null> {
  const record = await findLyricsByKeys(db, keys);
  if (!record) return null;
  if (track.duration === null || record.duration === null) return record;
  return Math.abs(track.duration - record.duration) <= 15 ? record : null;
}

export async function upsertLookupJob(db: D1Database, key: string, status: string): Promise<void> {
  const timestamp = now();
  await db.prepare(
    `INSERT INTO lookup_jobs (key, status, attempts, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(key) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
  ).bind(key, status, timestamp, timestamp).run();
}

export async function markLookupAttempt(db: D1Database, key: string, status: string, error?: string): Promise<void> {
  await db.prepare(
    `UPDATE lookup_jobs SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ? WHERE key = ?`
  ).bind(status, error ?? null, now(), key).run();
}

export async function storeNegativeCache(db: D1Database, track: TrackForLyrics, keys: LookupKey[], source = "queue"): Promise<void> {
  const timestamp = now();
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO lyrics (id, canonical_key, title, artist, album, duration, lyrics_type, source, confidence, found, lines_json, cached_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'none', ?, 0, 0, '[]', ?, ?, ?)
     ON CONFLICT(canonical_key) DO UPDATE SET found = 0, lyrics_type = 'none', updated_at = excluded.updated_at, expires_at = excluded.expires_at`
  ).bind(id, keys[0]?.key ?? id, track.title, track.artist, track.album, track.duration, source, timestamp, timestamp, timestamp + ttlForType("none")).run();
  await storeKeys(db, id, keys, timestamp);
}

export async function storeLyrics(db: D1Database, input: {
  track: TrackForLyrics;
  keys: LookupKey[];
  lyricsType: LyricsType;
  source: string;
  providerTrackId?: string;
  confidence: number;
  lines: unknown[];
  plainLyrics: string;
  syncedLyrics: string;
  instrumental?: boolean;
  temporaryFallback?: boolean;
}): Promise<void> {
  const timestamp = now();
  const id = crypto.randomUUID();
  const expiresAt = timestamp + (input.temporaryFallback ? ttlForFallbackType(input.lyricsType) : ttlForType(input.lyricsType));
  const canonical = input.keys[0]?.key ?? id;
  await db.prepare(
    `INSERT INTO lyrics (id, canonical_key, title, artist, album, duration, lyrics_type, source, provider_track_id, confidence, found, instrumental, lines_json, plain_lyrics, synced_lyrics, cached_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(canonical_key) DO UPDATE SET lyrics_type = excluded.lyrics_type, source = excluded.source, provider_track_id = excluded.provider_track_id, confidence = excluded.confidence, found = 1, instrumental = excluded.instrumental, lines_json = excluded.lines_json, plain_lyrics = excluded.plain_lyrics, synced_lyrics = excluded.synced_lyrics, updated_at = excluded.updated_at, expires_at = excluded.expires_at`
  ).bind(
    id,
    canonical,
    input.track.title,
    input.track.artist,
    input.track.album,
    input.track.duration,
    input.lyricsType,
    input.source,
    input.providerTrackId ?? null,
    input.confidence,
    input.instrumental ? 1 : 0,
    JSON.stringify(input.lines),
    input.plainLyrics,
    input.syncedLyrics,
    timestamp,
    timestamp,
    expiresAt
  ).run();
  await storeKeys(db, id, input.keys, timestamp);
}

async function storeKeys(db: D1Database, lyricsId: string, keys: LookupKey[], timestamp: number): Promise<void> {
  for (const lookupKey of keys) {
    await db.prepare(
      `INSERT INTO lyrics_keys (key, lyrics_id, key_type, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`
    ).bind(lookupKey.key, lyricsId, lookupKey.type, timestamp).run();
  }
}
