import type { TrackForLyrics } from "../types";
import { fetchWithTimeout } from "../lib/http";
import type { ProviderResult } from "./types";

export async function lookupSimpMusic(track: TrackForLyrics, timeoutMs = 7000): Promise<ProviderResult | null> {
  const url = new URL("https://music.youtube.com/youtubei/v1/search");
  url.searchParams.set("query", `${track.title} ${track.artist}`);
  const response = await fetchWithTimeout(url.toString(), {}, timeoutMs);
  if (!response.ok) throw new Error(`SimpMusic probe returned ${response.status}`);
  return null;
}
