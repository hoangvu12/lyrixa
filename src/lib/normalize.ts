import type { TrackForLyrics } from "../types";

const versionSuffixPattern = /\s*[\[(](?:official\s+)?(?:audio|video|lyrics?|visualizer|remaster(?:ed)?|radio\s+edit|album\s+version)[\])]/gi;

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(versionSuffixPattern, "")
    .toLowerCase()
    .replace(/[^a-z0-9'&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTrackFromSearchParams(params: URLSearchParams): TrackForLyrics | string {
  const title = params.get("title")?.trim() ?? "";
  const artist = params.get("artist")?.trim() ?? "";
  const album = params.get("album")?.trim() ?? "";
  const durationValue = params.get("duration")?.trim();

  if (!title || !artist) {
    return "title and artist are required";
  }

  const duration = durationValue ? Number(durationValue) : null;
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) {
    return "duration must be a positive number";
  }

  return { title, artist, album, duration };
}
