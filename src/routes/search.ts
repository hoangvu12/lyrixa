import type { Env } from "../types";
import { badRequest, json } from "../lib/response";

export async function search(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return badRequest("q is required");

  const like = `%${q}%`;
  const { results } = await env.DB.prepare(
    `SELECT title, artist, album, duration, lyrics_type AS lyricsType, source, confidence, cached_at AS cachedAt
     FROM lyrics WHERE found = 1 AND (title LIKE ? OR artist LIKE ? OR album LIKE ?) ORDER BY hit_count DESC, confidence DESC LIMIT 20`
  ).bind(like, like, like).all();
  return json({ status: "ok", results });
}
