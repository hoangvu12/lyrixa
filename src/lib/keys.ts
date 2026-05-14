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
  const compactArtist = compact(artist);
  const album = normalizeText(track.album);
  const duration = roundedDuration(track.duration);
  const artists = artistVariants(artist, compactArtist);

  const candidates: LookupKey[] = artists.flatMap((artistValue): LookupKey[] => duration
    ? [
      { type: "exact", key: joinKey([artistValue, title, album, `dur:${duration}`]) },
      { type: "no_album", key: joinKey([artistValue, title, `dur:${duration}`]) }
    ]
    : [
      { type: "no_duration", key: joinKey([artistValue, title, album]) },
      { type: "simple", key: joinKey([artistValue, title]) }
    ]);

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.key || seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });
}

function compact(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

function artistVariants(artist: string, compactArtist: string): string[] {
  const variants = [artist];
  if (compactArtist && compactArtist !== artist) variants.push(compactArtist);
  if (/^[a-z][a-z]{2,}$/.test(compactArtist)) variants.push(`${compactArtist[0]} ${compactArtist.slice(1)}`);
  return variants;
}

export function canonicalKey(track: TrackForLyrics): string {
  return buildLookupKeys(track)[0]?.key ?? "";
}
