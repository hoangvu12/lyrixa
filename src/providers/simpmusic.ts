import type { LyricLine, LyricWord, TrackForLyrics } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { isStrictMatch } from "../lib/ranking";
import { parseLrc } from "../parsers/lrc";
import type { ProviderResult } from "./types";

const baseUrl = "https://api-lyrics.simpmusic.org/v1";

interface SimpMusicLyric {
  id: string;
  videoId: string;
  songTitle: string;
  artistName: string;
  albumName: string;
  durationSeconds: number;
  plainLyric: string;
  syncedLyrics: string | null;
  richSyncLyrics: string | null;
  vote: number;
}

interface SimpMusicResponse {
  data?: SimpMusicLyric[];
  success?: boolean;
  type?: string;
}

export async function lookupSimpMusic(track: TrackForLyrics, timeoutMs = 7000): Promise<ProviderResult | null> {
  const candidates = await searchSimpMusic(track, timeoutMs);
  for (const candidate of candidates) {
    if (!isSimpMusicMatch(track, candidate)) continue;
    const result = toProviderResult(candidate);
    if (result) return result;
  }
  return null;
}

async function searchSimpMusic(track: TrackForLyrics, timeoutMs: number): Promise<SimpMusicLyric[]> {
  const queries = [
    ["/search/title", "title", track.title],
    ["/search", "q", `${track.title} ${track.artist}`]
  ] as const;

  for (const [path, param, value] of queries) {
    const url = new URL(`${baseUrl}${path}`);
    url.searchParams.set(param, value);
    url.searchParams.set("limit", "10");

    const response = await fetchWithTimeout(url.toString(), {}, timeoutMs);
    if (response.status === 404 || response.status === 429) continue;
    if (!response.ok) throw new Error(`SimpMusic returned ${response.status}`);

    const data = await response.json() as SimpMusicResponse;
    if (Array.isArray(data.data) && data.data.length > 0) return data.data;
  }

  return [];
}

function isSimpMusicMatch(track: TrackForLyrics, candidate: SimpMusicLyric): boolean {
  if (!isStrictMatch({ ...track, duration: null }, { ...toTrack(candidate), duration: null })) return false;
  if (track.duration === null || !Number.isFinite(candidate.durationSeconds)) return true;
  return Math.abs(track.duration - candidate.durationSeconds) <= 30;
}

function toTrack(candidate: SimpMusicLyric): TrackForLyrics {
  return {
    title: candidate.songTitle,
    artist: candidate.artistName,
    album: candidate.albumName,
    duration: Number.isFinite(candidate.durationSeconds) ? candidate.durationSeconds : null
  };
}

function toProviderResult(data: SimpMusicLyric): ProviderResult | null {
  const richSyncLyrics = data.richSyncLyrics ?? "";
  const syncedLyrics = data.syncedLyrics ?? "";
  const plainLyrics = data.plainLyric ?? "";
  const wordLines = richSyncLyrics ? parseRichSyncLyrics(richSyncLyrics) : [];
  if (wordLines.length > 3 && wordLines.some((line) => line.words && line.words.length > 0)) {
    return baseResult(data, "word", 0.86, wordLines, plainLyrics, syncedLyrics || richSyncLyrics, false);
  }

  const syncedLines = syncedLyrics ? parseLrc(syncedLyrics) : [];
  if (syncedLines.length > 3) return baseResult(data, "synced", 0.82, syncedLines, plainLyrics, syncedLyrics, false);
  if (plainLyrics.trim()) return baseResult(data, "plain", 0.74, [], plainLyrics, syncedLyrics, false);
  return null;
}

function baseResult(data: SimpMusicLyric, lyricsType: ProviderResult["lyricsType"], confidence: number, lines: LyricLine[], plainLyrics: string, syncedLyrics: string, instrumental: boolean): ProviderResult {
  return {
    lyricsType,
    source: "simpmusic",
    providerTrackId: data.videoId || data.id,
    sourceTitle: data.songTitle,
    sourceArtist: data.artistName,
    sourceAlbum: data.albumName,
    sourceDuration: data.durationSeconds,
    confidence,
    lines,
    plainLyrics,
    syncedLyrics,
    instrumental
  };
}

function parseRichSyncLyrics(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    const lineTime = parseLeadingTimestamp(rawLine);
    if (lineTime === null) continue;

    const words = parseWordTimings(rawLine);
    const text = rawLine
      .replace(/\[[^\]]+]/g, "")
      .replace(/<\d{1,2}:\d{2}(?:\.\d{1,3})?>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    lines.push({ time: lineTime, text, words });
  }

  return lines.sort((a, b) => a.time - b.time);
}

function parseWordTimings(rawLine: string): LyricWord[] {
  const matches = [...rawLine.matchAll(/<(?<time>\d{1,2}:\d{2}(?:\.\d{1,3})?)>\s*(?<text>[^<\[]*)/g)];
  return matches
    .map((match, index) => {
      const time = parseTimestamp(match.groups?.time ?? "");
      const text = decodeEntities(match.groups?.text ?? "").replace(/\s+/g, " ").trim();
      const nextTime = parseTimestamp(matches[index + 1]?.groups?.time ?? "");
      if (time === null || !text) return null;
      return { time, endTime: nextTime ?? time, text };
    })
    .filter((word): word is LyricWord => word !== null);
}

function parseLeadingTimestamp(rawLine: string): number | null {
  const match = rawLine.match(/^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)]/);
  return parseTimestamp(match?.[1] ?? "");
}

function parseTimestamp(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = Number((match[3] ?? "0").padEnd(3, "0")) / 1000;
  return minutes * 60 + seconds + fraction;
}

function decodeEntities(value: string): string {
  return value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
