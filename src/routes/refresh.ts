import type { Env, TrackForLyrics } from "../types";
import { buildLookupKeys } from "../lib/keys";
import { badRequest, json } from "../lib/response";
import { lookupAndCache } from "../lookup/live";

export async function refresh(request: Request, env: Env): Promise<Response> {
  let body: Partial<TrackForLyrics>;
  try {
    body = await request.json() as Partial<TrackForLyrics>;
  } catch {
    return badRequest("JSON body is required");
  }

  const title = body.title?.trim() ?? "";
  const artist = body.artist?.trim() ?? "";
  if (!title || !artist) return badRequest("title and artist are required");

  const track: TrackForLyrics = {
    title,
    artist,
    album: body.album?.trim() ?? "",
    duration: typeof body.duration === "number" && Number.isFinite(body.duration) ? body.duration : null
  };
  const keys = buildLookupKeys(track);
  const result = await lookupAndCache(env.DB, track, keys, { mode: "background" });
  if (result.status === "found" && result.result) {
    return json({
      status: "found",
      cache: "refreshed",
      track,
      lyricsType: result.result.lyricsType,
      source: result.result.source,
      quality: result.temporaryFallback ? "temporary_fallback" : "primary",
      unavailableProvider: result.unavailableProvider,
      confidence: result.result.confidence,
      lines: result.result.lines,
      plainLyrics: result.result.plainLyrics,
      instrumental: result.result.instrumental
    });
  }
  if (result.status === "not_found") return json({ status: "not_found", cache: "refreshed", message: "No lyrics found for this track." }, { status: 404 });
  return json({ status: "error", code: "provider_unavailable", message: "Lyrics providers did not respond with a usable result." }, { status: 503 });
}
