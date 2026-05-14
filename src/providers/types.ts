import type { LyricLine } from "../types";

export interface ProviderResult {
  lyricsType: "word" | "synced" | "plain" | "instrumental";
  source: string;
  providerTrackId: string;
  sourceTitle?: string;
  sourceArtist?: string;
  sourceAlbum?: string;
  sourceDuration?: number | null;
  confidence: number;
  lines: LyricLine[];
  plainLyrics: string;
  syncedLyrics: string;
  instrumental: boolean;
}
