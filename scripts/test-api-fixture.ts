interface Track {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

export {};

interface Result {
  track: Track;
  status: number;
  ok: boolean;
  ms: number;
  body: Record<string, unknown> | null;
  text: string;
}

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = ""] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));

const baseUrl = args.get("base-url") ?? "http://127.0.0.1:8787";
const concurrency = Number(args.get("concurrency") ?? 5);
const tracks = await Bun.file("fixtures/provider-benchmark-tracks.json").json() as Track[];

const results: Result[] = [];
let cursor = 0;

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < tracks.length) {
    const track = tracks[cursor++];
    results.push(await testTrack(track));
  }
}));

results.sort((a, b) => tracks.indexOf(a.track) - tracks.indexOf(b.track));

const found = results.filter((result) => result.status === 200).length;
const notFound = results.filter((result) => result.status === 404).length;
const errors = results.filter((result) => result.status >= 500 || result.status === 0).length;
const avg = Math.round(results.reduce((total, result) => total + result.ms, 0) / results.length);
const p90 = percentile(results.map((result) => result.ms), 0.9);

console.log("Status  Count");
for (const [status, count] of countBy(results, (result) => String(result.status))) console.log(`${status.padEnd(7)} ${count}`);

console.log("\nType    Count");
for (const [type, count] of countBy(results, (result) => String(result.body?.lyricsType ?? result.body?.status ?? "unknown"))) console.log(`${type.padEnd(7)} ${count}`);

console.log("\nSource              Count");
for (const [source, count] of countBy(results, (result) => String(result.body?.source ?? "none"))) console.log(`${source.padEnd(19)} ${count}`);

console.log("\nCache   Count");
for (const [cache, count] of countBy(results, (result) => String(result.body?.cache ?? "none"))) console.log(`${cache.padEnd(7)} ${count}`);

console.log(`\nSummary: ${results.length} req, ${found} found, ${notFound} not_found, ${errors} errors, avg ${avg}ms, p90 ${p90}ms`);

console.log("\nDetails");
for (const result of results) {
  const type = result.body?.lyricsType ?? result.body?.status ?? "unknown";
  const source = result.body?.source ?? "none";
  const cache = result.body?.cache ?? "none";
  const bodyNote = result.text ? "" : " empty-body";
  console.log(`${result.status} ${String(type).padEnd(9)} ${String(source).padEnd(19)} ${String(cache).padEnd(6)} ${String(result.ms).padStart(5)}ms ${result.track.artist} - ${result.track.title}${bodyNote}`);
}

async function testTrack(track: Track): Promise<Result> {
  const url = new URL("/v1/lyrics", baseUrl);
  url.searchParams.set("title", track.title);
  url.searchParams.set("artist", track.artist);
  if (track.album) url.searchParams.set("album", track.album);
  if (typeof track.duration === "number") url.searchParams.set("duration", String(track.duration));

  const started = performance.now();
  try {
    const response = await fetch(url);
    const text = await response.text();
    return {
      track,
      status: response.status,
      ok: response.ok,
      ms: Math.round(performance.now() - started),
      body: parseJson(text),
      text
    };
  } catch (error) {
    return {
      track,
      status: 0,
      ok: false,
      ms: Math.round(performance.now() - started),
      body: { status: "client_error", message: error instanceof Error ? error.message : "Unknown error" },
      text: ""
    };
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function countBy(items: Result[], key: (item: Result) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}
