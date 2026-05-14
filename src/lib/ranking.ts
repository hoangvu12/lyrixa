import type { TrackForLyrics } from "../types";
import { normalizeText } from "./normalize";

export function isStrictMatch(requested: TrackForLyrics, candidate: TrackForLyrics): boolean {
  if (!isArtistMatch(requested.artist, candidate.artist)) return false;
  if (!isTitleMatch(requested.title, candidate.title, requested.artist)) return false;
  if (requested.duration !== null && candidate.duration !== null) {
    return Math.abs(requested.duration - candidate.duration) <= 15;
  }
  return true;
}

function isTitleMatch(requested: string, candidate: string, artist: string): boolean {
  const requestedTitle = normalizeText(requested);
  const candidateTitle = normalizeText(candidate);
  if (requestedTitle === candidateTitle) return true;

  const artistName = normalizeText(artist);
  const artistParts = artistName.split(" ").filter(Boolean);
  const suffixes = [artistName, compact(artistName), ...artistParts].filter(Boolean);
  return suffixes.some((suffix) => candidateTitle === `${requestedTitle} ${suffix}` || candidateTitle === `${suffix} ${requestedTitle}`);
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
