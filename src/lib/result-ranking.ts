import type { TrackForLyrics } from "../types";
import type { ProviderResult } from "../providers/types";
import { isStrictMatch } from "./ranking";

export interface RankedProviderResult {
  result: ProviderResult;
  score: number;
  temporaryFallback: boolean;
}

const typeScores: Record<ProviderResult["lyricsType"], number> = {
  word: 100,
  synced: 80,
  instrumental: 75,
  plain: 45
};

const providerTrust: Record<string, number> = {
  "lyricsplus:prjktla": 10,
  lrclib: 9,
  "lyrics.ovh": 4,
  genius: 5,
  simpmusic: 2,
  "qq-music": 5,
  "lrc-cx": 4
};

export function rankProviderResult(track: TrackForLyrics, result: ProviderResult): RankedProviderResult | null {
  if (!isUsableResult(result)) return null;
  if (!isResultMatch(track, result)) return null;

  const typeScore = typeScores[result.lyricsType];
  const trustScore = providerTrust[result.source] ?? 3;
  const confidenceScore = Math.round(result.confidence * 20);
  const contentScore = scoreContent(result);
  const score = typeScore + trustScore + confidenceScore + contentScore;

  return {
    result,
    score,
    temporaryFallback: result.lyricsType === "plain" || trustScore < 5
  };
}

export function pickBestProviderResult(track: TrackForLyrics, results: ProviderResult[]): RankedProviderResult | null {
  return results
    .map((result) => rankProviderResult(track, result))
    .filter((ranked): ranked is RankedProviderResult => ranked !== null)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function isUsableResult(result: ProviderResult): boolean {
  if (result.instrumental || result.lyricsType === "instrumental") return true;
  if (result.lyricsType === "word") return result.lines.some((line) => line.words && line.words.length > 0);
  if (result.lyricsType === "synced") return result.lines.length > 3;
  if (result.lyricsType === "plain") return result.plainLyrics.trim().split(/\r?\n/).filter(Boolean).length >= 4;
  return false;
}

function isResultMatch(track: TrackForLyrics, result: ProviderResult): boolean {
  if (!result.sourceTitle && !result.sourceArtist) return true;
  return isStrictMatch(track, {
    title: result.sourceTitle ?? track.title,
    artist: result.sourceArtist ?? track.artist,
    album: result.sourceAlbum ?? "",
    duration: result.sourceDuration ?? null
  });
}

function scoreContent(result: ProviderResult): number {
  if (result.instrumental || result.lyricsType === "instrumental") return 6;
  if (result.lyricsType === "word") return Math.min(12, Math.floor(wordCount(result) / 80));
  if (result.lyricsType === "synced") return Math.min(10, Math.floor(result.lines.length / 12));
  return Math.min(6, Math.floor(result.plainLyrics.length / 500));
}

function wordCount(result: ProviderResult): number {
  return result.lines.reduce((count, line) => count + (line.words?.length ?? 0), 0);
}
