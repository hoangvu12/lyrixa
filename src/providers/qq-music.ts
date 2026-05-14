import type { TrackForLyrics } from "../types";
import { fetchWithTimeout } from "../lib/http";
import type { ProviderResult } from "./types";

const endpoint = "https://u.y.qq.com/cgi-bin/musics.fcg";
const versionCode = 13020508;

export async function lookupQqMusic(track: TrackForLyrics, timeoutMs = 7000): Promise<ProviderResult | null> {
  const requestData = buildRequestData("music.search.SearchCgiService", "DoSearchForQQMusicMobile", {
    searchid: String(Date.now()),
    query: `${track.title} ${track.artist}`,
    search_type: 0,
    num_per_page: 5,
    page_num: 1,
    highlight: 1,
    grp: 1
  });
  const response = await fetchWithTimeout(`${endpoint}?sign=${await generateSign(JSON.stringify(requestData))}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Referer": "https://y.qq.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Origin": "https://y.qq.com"
    },
    body: JSON.stringify(requestData)
  }, timeoutMs);
  if (!response.ok) throw new Error(`QQ Music search returned ${response.status}`);
  const data = await response.json() as Record<string, unknown>;
  const result = data["music.search.SearchCgiService.DoSearchForQQMusicMobile"] as { code?: number; data?: { body?: { item_song?: unknown[] } } } | undefined;
  if (!result || result.code !== 0) throw new Error("QQ Music invalid search response");
  if ((result.data?.body?.item_song?.length ?? 0) === 0) return null;
  return null;
}

function buildRequestData(module: string, method: string, params: Record<string, unknown>): Record<string, unknown> {
  return {
    comm: {
      wid: crypto.randomUUID().replace(/-/g, "").toUpperCase(),
      cv: versionCode,
      v: versionCode,
      QIMEI36: "8888888888888888",
      ct: "11",
      tmeAppID: "qqmusic",
      format: "json",
      inCharset: "utf-8",
      outCharset: "utf-8",
      uid: "3931641530"
    },
    [`${module}.${method}`]: { module, method, param: params }
  };
}

async function generateSign(json: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(json));
  const hash = [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  const part1 = [23, 14, 6, 36, 16, 40, 7, 19].filter((index) => index < hash.length).map((index) => hash[index] || "").join("");
  const part2 = [16, 1, 32, 12, 19, 27, 8, 5].map((index) => hash[index] || "").join("");
  const scramble = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
  const bytes = scramble.map((value, index) => value ^ Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16));
  const binary = String.fromCharCode(...bytes);
  const encoded = btoa(binary).replace(/[\/+='=]/g, "");
  return `zzc${part1}${encoded}${part2}`.toLowerCase();
}
