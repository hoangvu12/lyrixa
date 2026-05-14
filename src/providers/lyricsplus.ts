import type { TrackForLyrics } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { parseTtml } from "../parsers/ttml";
import type { ProviderResult } from "./types";

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
    if (!response.ok) throw new Error(`${label} returned ${response.status}`);

    const data = await response.json() as Record<string, unknown>;
    const ttml = stringField(data, "ttml") ?? stringField(data, "lrc_ttml") ?? "";
    if (ttml) {
      const lines = parseTtml(ttml);
      if (lines.length > 3 && lines.some((line) => line.words && line.words.length > 0)) {
        return { lyricsType: "word", source: label, providerTrackId: "", sourceTitle: track.title, sourceArtist: track.artist, sourceAlbum: track.album, sourceDuration: track.duration, confidence: 0.88, lines, plainLyrics: lines.map((line) => line.text).join("\n"), syncedLyrics: "", instrumental: false };
      }
      throw new Error(`TTML parse produced ${lines.length} lines`);
    }
    if (typeof data.error === "string") return null;
    return null;
  };
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : null;
}
