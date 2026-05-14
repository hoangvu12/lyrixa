import type { TrackForLyrics } from "../types";
import { normalizeText } from "./normalize";

export function isStrictMatch(requested: TrackForLyrics, candidate: TrackForLyrics): boolean {
  if (normalizeText(requested.title) !== normalizeText(candidate.title)) return false;
  if (!normalizeText(candidate.artist).includes(normalizeText(requested.artist))) return false;
  if (requested.duration !== null && candidate.duration !== null) {
    return Math.abs(requested.duration - candidate.duration) <= 15;
  }
  return true;
}
