import type { LyricLine } from "../types";

export interface LyricsFeatures {
  lineEndTime: boolean;
  overlappingLines: boolean;
}

export interface ProviderResult {
  lyricsType: "word" | "synced" | "plain" | "instrumental";
  source: string;
  providerTrackId: string;
  sourceTitle?: string;
  sourceArtist?: string;
  sourceAlbum?: string;
  sourceDuration?: number | null;
  confidence: number;
  features?: LyricsFeatures;
  lines: LyricLine[];
  plainLyrics: string;
  syncedLyrics: string;
  instrumental: boolean;
}
