import type { LookupKey, TrackForLyrics } from "../types";
import { normalizeText } from "./normalize";

function roundedDuration(duration: number | null): string {
  return duration === null ? "" : String(Math.round(duration));
}

function joinKey(parts: string[]): string {
  return parts.filter(Boolean).join("|");
}

export function buildLookupKeys(track: TrackForLyrics): LookupKey[] {
  const title = normalizeText(track.title);
  const artist = normalizeText(track.artist);
  const album = normalizeText(track.album);
  const duration = roundedDuration(track.duration);

  const candidates: LookupKey[] = [
    { type: "exact", key: joinKey([artist, title, album, duration]) },
    { type: "no_album", key: joinKey([artist, title, duration]) },
    { type: "no_duration", key: joinKey([artist, title, album]) },
    { type: "simple", key: joinKey([artist, title]) }
  ];

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.key || seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });
}

export function canonicalKey(track: TrackForLyrics): string {
  return buildLookupKeys(track)[0]?.key ?? "";
}
