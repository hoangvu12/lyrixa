import type { LyricLine, TrackForLyrics } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { isStrictMatch } from "../lib/ranking";
import { parseLrc } from "../parsers/lrc";
import type { ProviderResult } from "./types";

interface LrclibResponse {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export async function lookupLrclibExact(track: TrackForLyrics, timeoutMs = 5000): Promise<ProviderResult | null> {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("track_name", track.title);
  url.searchParams.set("artist_name", track.artist);
  if (track.album) url.searchParams.set("album_name", track.album);
  if (track.duration !== null) url.searchParams.set("duration", String(Math.round(track.duration)));

  const response = await fetchWithTimeout(url.toString(), {
    headers: { "User-Agent": "Lyrixa/0.1 (https://github.com/)" }
  }, timeoutMs);

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`LRCLIB returned ${response.status}`);

  const data = await response.json() as LrclibResponse;
  const candidate = {
    title: data.trackName,
    artist: data.artistName,
    album: data.albumName ?? "",
    duration: data.duration
  };
  if (!isStrictMatch(track, candidate)) return null;

  const syncedLyrics = data.syncedLyrics ?? "";
  const plainLyrics = data.plainLyrics ?? "";
  const lines = syncedLyrics ? parseLrc(syncedLyrics) : [];
  if (data.instrumental) {
    return baseResult(data, "instrumental", 0.95, [], plainLyrics, syncedLyrics, true);
  }
  if (lines.length > 3) {
    return baseResult(data, "synced", 0.9, lines, plainLyrics, syncedLyrics, false);
  }
  if (plainLyrics) {
    return baseResult(data, "plain", 0.82, [], plainLyrics, syncedLyrics, false);
  }
  return null;
}

export async function lookupLrclibSearch(track: TrackForLyrics, timeoutMs = 5000): Promise<ProviderResult | null> {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("track_name", track.title);
  url.searchParams.set("artist_name", track.artist);
  if (track.album) url.searchParams.set("album_name", track.album);

  const response = await fetchWithTimeout(url.toString(), {
    headers: { "User-Agent": "Lyrixa/0.1 (https://github.com/)" }
  }, timeoutMs);

  if (!response.ok) throw new Error(`LRCLIB search returned ${response.status}`);
  const results = await response.json() as LrclibResponse[];
  for (const data of results) {
    const candidate = {
      title: data.trackName,
      artist: data.artistName,
      album: data.albumName ?? "",
      duration: data.duration
    };
    if (!isStrictMatch(track, candidate)) continue;
    const syncedLyrics = data.syncedLyrics ?? "";
    const plainLyrics = data.plainLyrics ?? "";
    const lines = syncedLyrics ? parseLrc(syncedLyrics) : [];
    if (data.instrumental) return baseResult(data, "instrumental", 0.9, [], plainLyrics, syncedLyrics, true);
    if (lines.length > 3) return baseResult(data, "synced", 0.85, lines, plainLyrics, syncedLyrics, false);
    if (plainLyrics) return baseResult(data, "plain", 0.78, [], plainLyrics, syncedLyrics, false);
  }
  return null;
}

function baseResult(data: LrclibResponse, lyricsType: ProviderResult["lyricsType"], confidence: number, lines: LyricLine[], plainLyrics: string, syncedLyrics: string, instrumental: boolean): ProviderResult {
  return {
    lyricsType,
    source: "lrclib",
    providerTrackId: String(data.id),
    sourceTitle: data.trackName,
    sourceArtist: data.artistName,
    sourceAlbum: data.albumName,
    sourceDuration: data.duration,
    confidence,
    lines,
    plainLyrics,
    syncedLyrics,
    instrumental
  };
}
