export interface Env {
  DB: D1Database;
}

export interface TrackForLyrics {
  title: string;
  artist: string;
  album: string;
  duration: number | null;
}

export interface LyricWord {
  time: number;
  endTime: number;
  text: string;
}

export interface LyricLine {
  time: number;
  endTime?: number;
  text: string;
  words?: LyricWord[];
}

export type LyricsType = "word" | "synced" | "plain" | "instrumental" | "none";
export type PreferLyrics = "word" | "synced" | "any";

export interface LookupKey {
  key: string;
  type: "exact" | "no_album" | "no_duration" | "simple";
}

export interface LyricsRecord {
  id: string;
  canonical_key: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  lyrics_type: LyricsType;
  source: string;
  provider_track_id: string | null;
  confidence: number;
  found: number;
  instrumental: number;
  lines_json: string;
  plain_lyrics: string;
  synced_lyrics: string;
  cached_at: number;
  expires_at: number;
}
