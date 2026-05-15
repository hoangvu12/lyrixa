import type { TrackForLyrics } from "../types";
import { fetchWithTimeout } from "../lib/http";
import { isStrictMatch } from "../lib/ranking";
import type { ProviderResult } from "./types";

interface GeniusHit {
  result?: {
    id?: number;
    title?: string;
    primary_artist?: { name?: string };
    url?: string;
  };
}

interface VagalumeResponse {
  type?: string;
  art?: { name?: string };
  mus?: Array<{ id?: string; name?: string; text?: string; translate?: Array<{ text?: string }> }>;
}

interface LyricsOvhResponse {
  lyrics?: string;
}

interface ChartLyricsResponse {
  LyricId?: number;
  LyricSong?: string;
  LyricArtist?: string;
  Lyric?: string;
}

export async function lookupLyricsOvh(track: TrackForLyrics, timeoutMs = 5000): Promise<ProviderResult | null> {
  const url = new URL(`https://api.lyrics.ovh/v1/${encodeURIComponent(track.artist)}/${encodeURIComponent(track.title)}`);
  const response = await fetchWithTimeout(url.toString(), {}, timeoutMs);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Lyrics.ovh returned ${response.status}`);

  const data = await response.json() as LyricsOvhResponse;
  return plainResult("lyrics.ovh", `${track.artist}:${track.title}`, track, track.title, track.artist, data.lyrics ?? "", 0.56);
}

export async function lookupVagalume(track: TrackForLyrics, timeoutMs = 5000): Promise<ProviderResult | null> {
  const url = new URL("https://api.vagalume.com.br/search.php");
  url.searchParams.set("art", track.artist);
  url.searchParams.set("mus", track.title);

  const response = await fetchWithTimeout(url.toString(), {}, timeoutMs);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Vagalume returned ${response.status}`);

  const data = await response.json() as VagalumeResponse;
  if (data.type && data.type !== "exact" && data.type !== "aprox") return null;
  const song = data.mus?.find((candidate) => candidate.text?.trim()) ?? data.mus?.[0];
  if (!song?.text) return null;

  const candidate = { title: song.name ?? track.title, artist: data.art?.name ?? track.artist, album: "", duration: null };
  if (!isStrictMatch({ ...track, duration: null }, candidate)) return null;

  return plainResult("vagalume", song.id ?? `${candidate.artist}:${candidate.title}`, track, candidate.title, candidate.artist, song.text, 0.66);
}

export async function lookupChartLyrics(track: TrackForLyrics, timeoutMs = 5000): Promise<ProviderResult | null> {
  const url = new URL("http://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect");
  url.searchParams.set("artist", track.artist);
  url.searchParams.set("song", track.title);

  const response = await fetchWithTimeout(url.toString(), {}, timeoutMs);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`ChartLyrics returned ${response.status}`);

  const xml = await response.text();
  const title = xmlField(xml, "LyricSong") ?? track.title;
  const artist = xmlField(xml, "LyricArtist") ?? track.artist;
  const lyric = xmlField(xml, "Lyric") ?? "";
  const id = xmlField(xml, "LyricId") ?? `${artist}:${title}`;
  if (!lyric.trim() || id === "0") return null;
  if (!isStrictMatch({ ...track, duration: null }, { title, artist, album: "", duration: null })) return null;

  return plainResult("chartlyrics", id, track, title, artist, lyric, 0.58);
}

export async function lookupGenius(track: TrackForLyrics, timeoutMs = 8000): Promise<ProviderResult | null> {
  const searchUrl = new URL("https://genius.com/api/search/song");
  searchUrl.searchParams.set("q", `${track.artist} ${track.title}`);

  const searchResponse = await fetchWithTimeout(searchUrl.toString(), {}, timeoutMs);
  if (searchResponse.status === 404) return null;
  if (!searchResponse.ok) throw new Error(`Genius search returned ${searchResponse.status}`);

  const searchData = await searchResponse.json() as { response?: { sections?: Array<{ hits?: GeniusHit[] }> } };
  const hits = searchData.response?.sections?.flatMap((section) => section.hits ?? []) ?? [];
  for (const hit of hits) {
    const song = hit.result;
    const title = song?.title ?? "";
    const artist = song?.primary_artist?.name ?? "";
    const pageUrl = song?.url ?? "";
    if (!title || !artist || !pageUrl) continue;
    if (!isStrictMatch({ ...track, duration: null }, { title, artist, album: "", duration: null })) continue;

    const pageResponse = await fetchWithTimeout(pageUrl, {}, timeoutMs);
    if (!pageResponse.ok) continue;
    const html = await pageResponse.text();
    const lyrics = extractGeniusLyrics(html);
    if (!lyrics) continue;
    return plainResult("genius", String(song?.id ?? pageUrl), track, title, artist, lyrics, 0.68);
  }

  return null;
}

function plainResult(source: string, providerTrackId: string, track: TrackForLyrics, sourceTitle: string, sourceArtist: string, plainLyrics: string, confidence: number): ProviderResult | null {
  const normalized = normalizeLyrics(plainLyrics);
  if (normalized.split("\n").filter(Boolean).length < 4) return null;
  return {
    lyricsType: "plain",
    source,
    providerTrackId,
    sourceTitle,
    sourceArtist,
    sourceAlbum: track.album,
    sourceDuration: track.duration,
    confidence,
    lines: [],
    plainLyrics: normalized,
    syncedLyrics: "",
    instrumental: false
  };
}

function extractGeniusLyrics(html: string): string {
  const containers = [...html.matchAll(/<div[^>]+data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => match[1]);
  if (containers.length === 0) return "";
  return normalizeLyrics(containers.join("\n"));
}

function normalizeLyrics(value: string): string {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function xmlField(xml: string, field: string): string | null {
  const match = xml.match(new RegExp(`<${field}>([\\s\\S]*?)<\/${field}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
