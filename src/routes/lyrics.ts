import type { Env, LyricsRecord, PreferLyrics } from "../types";
import { findLyricsByKeysForTrack } from "../lib/db";
import { buildLookupKeys } from "../lib/keys";
import { parseTrackFromSearchParams } from "../lib/normalize";
import { badRequest, json } from "../lib/response";
import { now } from "../lib/time";
import { lookupAndCache } from "../lookup/live";

export async function lyrics(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const trackOrResponse = parseTrackFromSearchParams(url.searchParams);
  if (typeof trackOrResponse === "string") return badRequest(trackOrResponse);

  const prefer = (url.searchParams.get("prefer") ?? "word") as PreferLyrics;
  if (!["word", "synced", "any"].includes(prefer)) return badRequest("prefer must be word, synced, or any");

  const keys = buildLookupKeys(trackOrResponse);
  const record = await findLyricsByKeysForTrack(env.DB, trackOrResponse, keys);
  const timestamp = now();
  if (record) {
    await env.DB.prepare("UPDATE lyrics SET last_requested_at = ?, hit_count = hit_count + 1 WHERE id = ?").bind(timestamp, record.id).run();
    if (record.found === 0 && record.expires_at > timestamp) {
      return json({ status: "not_found", cache: "negative_hit", retryAfter: Math.ceil((record.expires_at - timestamp) / 1000) }, { status: 404 });
    }
    if (record.found === 1) {
      const stale = record.expires_at <= timestamp;
      if ((stale || url.searchParams.get("refresh") === "1") && url.searchParams.get("stale") !== "1") return lookupLive(env, trackOrResponse, keys, "background");
      return json(recordToResponse(record, stale ? "stale" : "hit"), {
        headers: { "Cache-Control": stale ? "public, max-age=60" : "public, max-age=3600" }
      });
    }
  }

  return lookupColdMiss(env, ctx, trackOrResponse, keys);
}

type Track = Parameters<typeof buildLookupKeys>[0];
type Keys = ReturnType<typeof buildLookupKeys>;

// Cold cache miss. Tries only the fast primary provider (LyricsPlus is
// worker-to-worker and returns in ~1s); if it has the track we serve it
// immediately. Otherwise we warm the slow fallbacks (LRCLIB et al., which can
// take 8-11s) in the background via ctx.waitUntil and return the existing 503
// (with a Retry-After hint) so the client's retry lands on a warm cache hit
// instead of blocking on provider latency. Returning 503 rather than a new
// status keeps the response contract identical for existing clients.
async function lookupColdMiss(env: Env, ctx: ExecutionContext, track: Track, keys: Keys): Promise<Response> {
  const fast = await lookupAndCache(env.DB, track, keys, { mode: "fast", fallbacks: false, skipNegativeCache: true });
  if (fast.status === "found" && fast.result) return foundResponse(track, fast);

  ctx.waitUntil(lookupAndCache(env.DB, track, keys, { mode: "background" }));
  return json(
    { status: "error", code: "provider_unavailable", message: "Lyrics providers did not respond with a usable result." },
    { status: 503, headers: { "Retry-After": "3" } }
  );
}

async function lookupLive(env: Env, track: Track, keys: Keys, mode: "fast" | "background"): Promise<Response> {
  const result = await lookupAndCache(env.DB, track, keys, { mode });
  if (result.status === "found" && result.result) return foundResponse(track, result);
  if (result.status === "not_found") return json({ status: "not_found", cache: "miss", message: "No lyrics found for this track." }, { status: 404 });
  return json({ status: "error", code: "provider_unavailable", message: "Lyrics providers did not respond with a usable result." }, { status: 503 });
}

function foundResponse(track: Track, result: Awaited<ReturnType<typeof lookupAndCache>>): Response {
  return json({
    status: "found",
    cache: "miss",
    track,
    lyricsType: result.result!.lyricsType,
    source: result.result!.source,
    quality: result.temporaryFallback ? "temporary_fallback" : "primary",
    unavailableProvider: result.unavailableProvider,
    confidence: result.result!.confidence,
    features: result.result!.features,
    lines: result.result!.lines,
    plainLyrics: result.result!.plainLyrics,
    instrumental: result.result!.instrumental
  });
}

function recordToResponse(record: LyricsRecord, cache: "hit" | "stale") {
  const lines = JSON.parse(record.lines_json);
  return {
    status: "found",
    cache,
    track: {
      title: record.title,
      artist: record.artist,
      album: record.album,
      duration: record.duration
    },
    lyricsType: record.lyrics_type,
    source: record.source,
    confidence: record.confidence,
    features: featuresForLines(lines),
    lines,
    plainLyrics: record.plain_lyrics,
    instrumental: record.instrumental === 1,
    cachedAt: record.cached_at,
    expiresAt: record.expires_at
  };
}

function featuresForLines(lines: unknown) {
  if (!Array.isArray(lines)) return undefined;
  const timedLines = lines.filter((line): line is { time: number; endTime?: number } => typeof line === "object" && line !== null && typeof (line as { time?: unknown }).time === "number");
  const lineEndTime = timedLines.some((line) => typeof line.endTime === "number");
  if (!lineEndTime) return undefined;
  return { lineEndTime, overlappingLines: hasOverlappingLines(timedLines) };
}

function hasOverlappingLines(lines: { time: number; endTime?: number }[]): boolean {
  for (let index = 0; index < lines.length; index++) {
    const current = lines[index];
    if (typeof current.endTime !== "number") continue;
    for (let otherIndex = index + 1; otherIndex < lines.length; otherIndex++) {
      const other = lines[otherIndex];
      if (typeof other.endTime !== "number") continue;
      if (other.time >= current.endTime) break;
      if (current.time < other.endTime && other.time < current.endTime) return true;
    }
  }
  return false;
}
