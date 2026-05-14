import type { TrackForLyrics } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { parseLrc } from "../parsers/lrc";
import type { ProviderResult } from "./types";

export async function lookupLrcCx(track: TrackForLyrics, timeoutMs = 5000): Promise<ProviderResult | null> {
  const url = new URL("https://lrclib.lrc.cx/api/get");
  url.searchParams.set("track_name", track.title);
  url.searchParams.set("artist_name", track.artist);
  if (track.album) url.searchParams.set("album_name", track.album);
  if (track.duration !== null) url.searchParams.set("duration", String(Math.round(track.duration)));

  const response = await fetchWithTimeout(url.toString(), {}, timeoutMs);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`LRC.cx returned ${response.status}`);

  const data = await response.json() as Record<string, unknown>;
  const lrc = stringField(data, "lrc") ?? stringField(data, "syncedLyrics") ?? "";
  const plainLyrics = stringField(data, "plainLyrics") ?? stringField(data, "lyrics") ?? "";
  const lines = lrc ? parseLrc(lrc) : [];
  if (lines.length > 3) {
    return { lyricsType: "synced", source: "lrc-cx", providerTrackId: String(data.id ?? ""), sourceTitle: track.title, sourceArtist: track.artist, sourceAlbum: track.album, sourceDuration: track.duration, confidence: 0.75, lines, plainLyrics, syncedLyrics: lrc, instrumental: false };
  }
  if (plainLyrics) {
    return { lyricsType: "plain", source: "lrc-cx", providerTrackId: String(data.id ?? ""), sourceTitle: track.title, sourceArtist: track.artist, sourceAlbum: track.album, sourceDuration: track.duration, confidence: 0.65, lines: [], plainLyrics, syncedLyrics: "", instrumental: false };
  }
  return null;
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : null;
}
