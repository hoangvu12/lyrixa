import type { LookupKey, TrackForLyrics } from "../types";
import { storeLyrics, storeNegativeCache } from "../lib/db";
import { pickBestProviderResult } from "../lib/result-ranking";
import { createLyricsPlusLookup } from "../providers/lyricsplus";
import { lookupLrclibSearch } from "../providers/lrclib";
import { lookupGenius, lookupLyricsOvh } from "../providers/plain-fallbacks";
import { providerTimeouts } from "../providers/timeouts";
import type { ProviderResult } from "../providers/types";

interface LookupOptions {
  mode: "fast" | "background";
  // When false, only the fast primary provider (LyricsPlus) is tried; the slow
  // fallbacks (LRCLIB, lyrics.ovh, Genius) are skipped. Used by the user-facing
  // cold-miss path, which warms the fallbacks in the background instead.
  fallbacks?: boolean;
  // When true, a clean "not found" outcome is not written to the negative cache.
  // Used for the primary-only attempt so a miss there does not block the
  // background fallback lookup from running and caching a real result.
  skipNegativeCache?: boolean;
}

interface LookupOutcome {
  status: "found" | "not_found" | "error";
  result?: ProviderResult;
  temporaryFallback?: boolean;
  unavailableProvider?: string;
  error?: string;
}

const lookupLyricsPlus = createLyricsPlusLookup("https://lyrics.geeked.wtf", "lyricsplus:prjktla");

export async function lookupAndCache(db: D1Database, track: TrackForLyrics, keys: LookupKey[], options: LookupOptions): Promise<LookupOutcome> {
  const result = await runProviders(track, options);
  if (result.status !== "found" || !result.result) {
    if (result.status === "not_found" && !options.skipNegativeCache) await storeNegativeCache(db, track, keys, "providers");
    return result;
  }

  await storeLyrics(db, {
    track,
    keys,
    lyricsType: result.result.lyricsType,
    source: result.result.source,
    providerTrackId: result.result.providerTrackId,
    confidence: result.result.confidence,
    lines: result.result.lines,
    plainLyrics: result.result.plainLyrics,
    syncedLyrics: result.result.syncedLyrics,
    instrumental: result.result.instrumental,
    temporaryFallback: result.temporaryFallback
  });

  return result;
}

async function runProviders(track: TrackForLyrics, options: LookupOptions): Promise<LookupOutcome> {
  const errors: string[] = [];
  const lyricsPlusTimeout = options.mode === "fast" ? providerTimeouts.lyricsPlus.fast : providerTimeouts.lyricsPlus.background;
  const lyricsPlus = await tryLyricsPlus(track, options.mode, lyricsPlusTimeout);
  const primary = pickBestFromOutcomes(track, [lyricsPlus]);
  if (primary) return { status: "found", result: primary.result, temporaryFallback: primary.temporaryFallback };
  if (lyricsPlus.status === "unavailable") errors.push(lyricsPlus.error);

  if (options.fallbacks === false) {
    return errors.length > 0 ? { status: "error", error: errors.join("; ") } : { status: "not_found" };
  }

  const fallbackOutcomes: ProviderOutcome[] = [];

  const lrclibTimeout = options.mode === "fast" ? providerTimeouts.lrclibSearch.fast : providerTimeouts.lrclibSearch.background;
  if (lrclibTimeout > 0) {
    const lrclib = await tryProvider("lrclib", () => lookupLrclibSearch(track, lrclibTimeout));
    fallbackOutcomes.push(lrclib);
    if (lrclib.status === "unavailable") errors.push(lrclib.error);
  }

  const lyricsOvh = await tryProvider("lyrics.ovh", () => lookupLyricsOvh(track, providerTimeouts.plainFallback.fast));
  fallbackOutcomes.push(lyricsOvh);
  if (lyricsOvh.status === "unavailable") errors.push(lyricsOvh.error);

  if (options.mode === "background") {
    const genius = await tryProvider("genius", () => lookupGenius(track, providerTimeouts.plainFallback.background));
    fallbackOutcomes.push(genius);
    if (genius.status === "unavailable") errors.push(genius.error);
  }

  const fallback = pickBestFromOutcomes(track, fallbackOutcomes);
  if (fallback) {
    return {
      status: "found",
      result: fallback.result,
      temporaryFallback: lyricsPlus.status === "unavailable" || fallback.temporaryFallback,
      unavailableProvider: lyricsPlus.status === "unavailable" ? "lyricsplus:prjktla" : undefined
    };
  }

  return errors.length > 0 ? { status: "error", error: errors.join("; ") } : { status: "not_found" };
}

type ProviderOutcome =
  | { status: "found"; result: ProviderResult }
  | { status: "not_found" }
  | { status: "unavailable"; provider: string; error: string };

async function tryLyricsPlus(track: TrackForLyrics, mode: LookupOptions["mode"], timeoutMs: number): Promise<ProviderOutcome> {
  const first = await tryProvider("lyricsplus:prjktla", () => lookupLyricsPlus(track, timeoutMs));
  if (first.status !== "unavailable") return first;

  const retryTimeout = mode === "fast" ? 1000 : 3000;
  const retry = await tryProvider("lyricsplus:prjktla", () => lookupLyricsPlus(track, retryTimeout));
  return retry.status === "unavailable"
    ? { status: "unavailable", provider: "lyricsplus:prjktla", error: `${first.error}; retry failed: ${retry.error}` }
    : retry;
}

async function tryProvider(provider: string, lookup: () => Promise<ProviderResult | null>): Promise<ProviderOutcome> {
  try {
    const result = await lookup();
    return result ? { status: "found", result } : { status: "not_found" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provider error";
    if (message.includes("404") || message.includes("400")) return { status: "not_found" };
    return { status: "unavailable", provider, error: message };
  }
}

function pickBestFromOutcomes(track: TrackForLyrics, outcomes: ProviderOutcome[]) {
  return pickBestProviderResult(track, outcomes.flatMap((outcome) => outcome.status === "found" ? [outcome.result] : []));
}
