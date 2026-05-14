import type { Env, LyricsRecord, PreferLyrics } from "../types";
import { findLyricsByKeysForTrack } from "../lib/db";
import { buildLookupKeys } from "../lib/keys";
import { parseTrackFromSearchParams } from "../lib/normalize";
import { badRequest, json } from "../lib/response";
import { now } from "../lib/time";
import { lookupAndCache } from "../lookup/live";

export async function lyrics(request: Request, env: Env): Promise<Response> {
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

  return lookupLive(env, trackOrResponse, keys, "fast");
}

async function lookupLive(env: Env, track: Parameters<typeof buildLookupKeys>[0], keys: ReturnType<typeof buildLookupKeys>, mode: "fast" | "background"): Promise<Response> {
  const result = await lookupAndCache(env.DB, track, keys, { mode });
  if (result.status === "found" && result.result) {
    return json({
      status: "found",
      cache: "miss",
      track,
      lyricsType: result.result.lyricsType,
      source: result.result.source,
      quality: result.temporaryFallback ? "temporary_fallback" : "primary",
      unavailableProvider: result.unavailableProvider,
      confidence: result.result.confidence,
      lines: result.result.lines,
      plainLyrics: result.result.plainLyrics,
      instrumental: result.result.instrumental
    });
  }
  if (result.status === "not_found") return json({ status: "not_found", cache: "miss", message: "No lyrics found for this track." }, { status: 404 });
  return json({ status: "error", code: "provider_unavailable", message: "Lyrics providers did not respond with a usable result." }, { status: 503 });
}

function recordToResponse(record: LyricsRecord, cache: "hit" | "stale") {
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
    lines: JSON.parse(record.lines_json),
    plainLyrics: record.plain_lyrics,
    instrumental: record.instrumental === 1,
    cachedAt: record.cached_at,
    expiresAt: record.expires_at
  };
}
