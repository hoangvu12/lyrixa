import type { TrackForLyrics } from "../types";
import { normalizeText } from "./normalize";

export function isStrictMatch(requested: TrackForLyrics, candidate: TrackForLyrics): boolean {
  if (normalizeText(requested.title) !== normalizeText(candidate.title)) return false;
  if (!isArtistMatch(requested.artist, candidate.artist)) return false;
  if (requested.duration !== null && candidate.duration !== null) {
    return Math.abs(requested.duration - candidate.duration) <= 15;
  }
  return true;
}

function isArtistMatch(requested: string, candidate: string): boolean {
  const requestedArtist = normalizeText(requested);
  const candidateArtist = normalizeText(candidate);
  if (candidateArtist.includes(requestedArtist)) return true;
  const requestedCompact = compact(requestedArtist);
  const candidateCompact = compact(candidateArtist);
  if (candidateCompact.includes(requestedCompact)) return true;
  return candidateCompact.includes(spacedLeadingInitial(requestedCompact).replace(/\s/g, ""));
}

function compact(value: string): string {
  return value.replace(/[^a-z0-9]/g, "");
}

function spacedLeadingInitial(value: string): string {
  return /^[a-z][a-z]{2,}$/.test(value) ? `${value[0]} ${value.slice(1)}` : value;
}
