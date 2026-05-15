/// <reference types="bun" />

import tracks from "../fixtures/provider-benchmark-tracks.json";
import type { LyricsType, TrackForLyrics } from "../src/types";
import { lookupLrcCx } from "../src/providers/lrc-cx";
import { lookupLrclibExact, lookupLrclibSearch } from "../src/providers/lrclib";
import { createLyricsPlusLookup } from "../src/providers/lyricsplus";
import { lookupQqMusic } from "../src/providers/qq-music";
import { lookupSimpMusic } from "../src/providers/simpmusic";
import { lookupChartLyrics, lookupGenius, lookupLyricsOvh, lookupVagalume } from "../src/providers/plain-fallbacks";
import type { ProviderResult } from "../src/providers/types";
import { providerTimeouts } from "../src/providers/timeouts";
import { isStrictMatch } from "../src/lib/ranking";

interface BenchmarkTrack extends TrackForLyrics {
  expect?: LyricsType[];
  rejectExamples?: string[];
}

interface BenchmarkRecord {
  provider: string;
  track: TrackForLyrics;
  status: "hit" | "miss" | "timeout" | "error" | "rejected";
  lyricsType: LyricsType | "none";
  durationMs: number;
  confidence: number | null;
  lineCount: number;
  wordCount: number;
  rejectedReason: string | null;
  falsePositiveWarnings: string[];
}

interface ProviderMetrics {
  provider: string;
  requests: number;
  hits: number;
  misses: number;
  timeouts: number;
  errors: number;
  parseFailures: number;
  rejected: number;
  wordHits: number;
  syncedHits: number;
  plainHits: number;
  falsePositiveWarnings: number;
  avgMs: number;
  medianMs: number;
  p90Ms: number;
  minMs: number;
  maxMs: number;
}

const args = new Map(
  process.argv.slice(2).map((arg: string) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  })
);

const providerFilter = args.get("provider") ?? "lrclib:get";
const limit = Number(args.get("limit") ?? tracks.length);
const timeoutOverride = args.get("timeout");
const concurrency = Math.max(1, Number(args.get("concurrency") ?? 3));
const jsonOutput = args.has("json");

const providers = [
  { label: "lrc-cx", run: lookupLrcCx, timeoutMs: providerTimeouts.lrcCx.background },
  { label: "lyricsplus:prjktla", run: createLyricsPlusLookup("https://lyricsplus.prjktla.workers.dev", "lyricsplus:prjktla"), timeoutMs: providerTimeouts.lyricsPlus.background },
  { label: "simpmusic", run: lookupSimpMusic, timeoutMs: providerTimeouts.simpMusic.background },
  { label: "lrclib:get", run: lookupLrclibExact, timeoutMs: providerTimeouts.lrclibExact.background },
  { label: "lrclib:search", run: lookupLrclibSearch, timeoutMs: providerTimeouts.lrclibSearch.background },
  { label: "qq-music", run: lookupQqMusic, timeoutMs: providerTimeouts.qqMusic.background },
  { label: "genius", run: lookupGenius, timeoutMs: providerTimeouts.plainFallback.background },
  { label: "vagalume", run: lookupVagalume, timeoutMs: providerTimeouts.plainFallback.background },
  { label: "lyrics.ovh", run: lookupLyricsOvh, timeoutMs: providerTimeouts.plainFallback.background },
  { label: "chartlyrics", run: lookupChartLyrics, timeoutMs: providerTimeouts.plainFallback.background }
].filter((provider) => providerFilter === "all" || providerFilter.split(/[ ,]+/).includes(provider.label));

if (providers.length === 0) {
  throw new Error(`No benchmark provider matched ${providerFilter}`);
}

const selectedTracks = (tracks as BenchmarkTrack[]).slice(0, limit);
const records: BenchmarkRecord[] = [];

for (const provider of providers) {
  const providerRecords = await runWithConcurrency(selectedTracks, concurrency, async (track) => {
    const started = performance.now();
    try {
      const result = await provider.run(track, timeoutOverride ? Number(timeoutOverride) : provider.timeoutMs);
      const durationMs = Math.round(performance.now() - started);
      if (!result) {
        return toRecord(provider.label, track, "miss", "none", durationMs, null, 0, 0, "No usable result", []);
      }

      const classifiedType = classifyResult(result);
      const warnings = qualityWarnings(track, result, classifiedType);
      return toRecord(
        provider.label,
        track,
        warnings.length > 0 ? "rejected" : "hit",
        classifiedType,
        durationMs,
        result.confidence,
        result.lines.length,
        result.lines.reduce((count, line) => count + (line.words?.length ?? 0), 0),
        warnings.length > 0 ? warnings.join("; ") : null,
        warnings
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - started);
      const isTimeout = error instanceof Error && error.name === "AbortError";
      return toRecord(provider.label, track, isTimeout ? "timeout" : "error", "none", durationMs, null, 0, 0, error instanceof Error ? error.message : "Unknown error", []);
    }
  });
  records.push(...providerRecords);
}

if (jsonOutput) {
  console.log(JSON.stringify({ records, metrics: summarize(records) }, null, 2));
} else {
  printSummary(summarize(records));
  printDetails(records);
}

function toRecord(provider: string, track: TrackForLyrics, status: BenchmarkRecord["status"], lyricsType: LyricsType | "none", durationMs: number, confidence: number | null, lineCount: number, wordCount: number, rejectedReason: string | null, falsePositiveWarnings: string[]): BenchmarkRecord {
  return { provider, track, status, lyricsType, durationMs, confidence, lineCount, wordCount, rejectedReason, falsePositiveWarnings };
}

function classifyResult(result: ProviderResult): LyricsType {
  if (result.instrumental) return "instrumental";
  if (result.lines.some((line) => line.words && line.words.length > 0)) return "word";
  if (result.lines.length > 3) return "synced";
  if (result.plainLyrics.trim()) return "plain";
  return "none";
}

function qualityWarnings(track: BenchmarkTrack, result: ProviderResult, lyricsType: LyricsType): string[] {
  const warnings: string[] = [];
  const expected = new Set(track.expect ?? []);
  if (expected.has("word")) expected.add("synced");
  if (expected.has("word") || expected.has("synced")) expected.add("plain");
  if (track.expect && !expected.has(lyricsType)) warnings.push(`expected ${[...expected].join("/")} but got ${lyricsType}`);
  if ((lyricsType === "synced" || lyricsType === "word") && result.lines.length < 4) warnings.push("too few synced lines");
  if (lyricsType === "word" && !result.lines.some((line) => line.words && line.words.length > 0)) warnings.push("word type without word timings");
  if (lyricsType === "synced" && result.lines.some((line) => line.words && line.words.length > 0)) warnings.push("synced type contains word timings");
  if (result.sourceTitle || result.sourceArtist) {
    const candidate = {
      title: result.sourceTitle ?? track.title,
      artist: result.sourceArtist ?? track.artist,
      album: result.sourceAlbum ?? "",
      duration: result.sourceDuration ?? null
    };
    if (!isStrictMatch(track, candidate)) warnings.push(`metadata mismatch: ${candidate.artist} - ${candidate.title}`);
  }
  for (const rejectExample of track.rejectExamples ?? []) {
    if (result.plainLyrics.toLowerCase().includes(rejectExample.toLowerCase())) warnings.push(`contains reject example: ${rejectExample}`);
  }
  return warnings;
}

async function runWithConcurrency<T, R>(items: T[], maxConcurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function summarize(allRecords: BenchmarkRecord[]): ProviderMetrics[] {
  const grouped = groupByProvider(allRecords);
  return [...grouped.entries()].map(([provider, providerRecords]) => {
    const durations = providerRecords.map((record) => record.durationMs).sort((a, b) => a - b);
    return {
      provider,
      requests: providerRecords.length,
      hits: providerRecords.filter((record) => record.status === "hit").length,
      misses: providerRecords.filter((record) => record.status === "miss").length,
      timeouts: providerRecords.filter((record) => record.status === "timeout").length,
      errors: providerRecords.filter((record) => record.status === "error").length,
      parseFailures: 0,
      rejected: providerRecords.filter((record) => record.status === "rejected").length,
      wordHits: providerRecords.filter((record) => record.status === "hit" && record.lyricsType === "word").length,
      syncedHits: providerRecords.filter((record) => record.status === "hit" && record.lyricsType === "synced").length,
      plainHits: providerRecords.filter((record) => record.status === "hit" && record.lyricsType === "plain").length,
      falsePositiveWarnings: providerRecords.reduce((sum, record) => sum + record.falsePositiveWarnings.length, 0),
      avgMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length)),
      medianMs: percentile(durations, 50),
      p90Ms: percentile(durations, 90),
      minMs: durations[0] ?? 0,
      maxMs: durations.at(-1) ?? 0
    };
  });
}

function groupByProvider(allRecords: BenchmarkRecord[]): Map<string, BenchmarkRecord[]> {
  const grouped = new Map<string, BenchmarkRecord[]>();
  for (const record of allRecords) {
    const providerRecords = grouped.get(record.provider) ?? [];
    providerRecords.push(record);
    grouped.set(record.provider, providerRecords);
  }
  return grouped;
}

function percentile(values: number[], percent: number): number {
  if (values.length === 0) return 0;
  const index = Math.ceil((percent / 100) * values.length) - 1;
  return values[Math.max(0, Math.min(index, values.length - 1))];
}

function printSummary(metrics: ProviderMetrics[]): void {
  console.log("Provider              Req  Hit  Word  Sync  Plain  Miss  Err  T/O  Reject  Avg   P90");
  for (const metric of metrics) {
    console.log([
      metric.provider.padEnd(21),
      String(metric.requests).padEnd(4),
      String(metric.hits).padEnd(4),
      String(metric.wordHits).padEnd(5),
      String(metric.syncedHits).padEnd(5),
      String(metric.plainHits).padEnd(6),
      String(metric.misses).padEnd(5),
      String(metric.errors).padEnd(5),
      String(metric.timeouts).padEnd(4),
      String(metric.rejected).padEnd(7),
      String(metric.avgMs).padEnd(5),
      String(metric.p90Ms)
    ].join(""));
  }
}

function printDetails(allRecords: BenchmarkRecord[]): void {
  console.log("\nDetails");
  for (const record of allRecords) {
    const label = `${record.track.artist} - ${record.track.title}`;
    const reason = record.rejectedReason ? ` (${record.rejectedReason})` : "";
    console.log(`${record.provider}: ${record.status} ${record.lyricsType} ${record.durationMs}ms ${label}${reason}`);
  }
}
