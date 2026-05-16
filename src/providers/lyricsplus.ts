import type { TrackForLyrics } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { parseTtml } from "../parsers/ttml";
import type { LyricsFeatures, ProviderResult } from "./types";

export function createLyricsPlusLookup(baseUrl: string, label: string) {
  return async function lookupLyricsPlus(track: TrackForLyrics, timeoutMs = 6000): Promise<ProviderResult | null> {
    const url = new URL("/v1/ttml/get", baseUrl);
    url.searchParams.set("title", track.title);
    url.searchParams.set("artist", track.artist);
    if (track.album) url.searchParams.set("album", track.album);
    if (track.duration !== null) url.searchParams.set("duration", String(Math.round(track.duration)));
    url.searchParams.set("source", "apple,lyricsplus,qq,musixmatch-word,musixmatch");

    const response = await fetchWithTimeout(url.toString(), {}, timeoutMs);
    if (response.status === 404) return null;
    if (response.status === 400) return null;
    if (response.status === 429) return null;
    if (!response.ok) throw new Error(`${label} returned ${response.status}`);

    const data = await response.json() as Record<string, unknown>;
    const ttml = stringField(data, "ttml") ?? stringField(data, "lrc_ttml") ?? "";
    if (ttml) {
      const lines = parseTtml(ttml);
      if (lines.length > 3) {
        const lyricsType = lines.some((line) => line.words && line.words.length > 0) ? "word" : "synced";
        return { lyricsType, source: label, providerTrackId: "", sourceTitle: track.title, sourceArtist: track.artist, sourceAlbum: track.album, sourceDuration: track.duration, confidence: 0.88, features: featuresForLines(lines), lines, plainLyrics: lines.map((line) => line.text).join("\n"), syncedLyrics: "", instrumental: false };
      }
      return null;
    }
    if (typeof data.error === "string") return null;
    return null;
  };
}

function featuresForLines(lines: { time: number; endTime?: number }[]): LyricsFeatures {
  const lineEndTime = lines.some((line) => typeof line.endTime === "number");
  return { lineEndTime, overlappingLines: lineEndTime && hasOverlappingLines(lines) };
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

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : null;
}
