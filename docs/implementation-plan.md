# Lyrixa Implementation Plan

## Decision

Build a separate public API as a Cloudflare Worker using only free-tier-friendly Cloudflare services for now:

- Cloudflare Workers for HTTP routes.
- Cloudflare D1 for durable structured cache.
- Cloudflare KV for selective hot response cache only.
- Cloudflare Queues for background lookups and refreshes.
- Cloudflare Cache API for regional response caching.
- TypeScript for application, provider, parser, and benchmark code.
- Bun for local package management and scripts.
- Wrangler for local Worker emulation and deployment.

Do not depend on live provider calls for every public request. The public API should behave like a cached lyrics index with background enrichment, not a live lyrics proxy.

## Core Requirements

- Preserve word-level lyrics with `LyricLine.words`.
- Keep all current providers as candidates over time: LRC.cx, LyricsPlus, SimpMusic, QQ Music, and LRCLIB.
- Never trust provider search order.
- Score and validate title, artist, album, duration, suspicious version terms, and synced quality.
- Cache misses to avoid repeatedly hammering providers.
- Stay free until real usage forces upgrades.
- Keep the first version small enough to ship quickly.

## API Contract

### `GET /health`

Returns service status.

```json
{
  "ok": true,
  "service": "lyrixa"
}
```

### `GET /v1/lyrics`

Query params:

| Param | Required | Notes |
| --- | --- | --- |
| `title` | yes | Track title. |
| `artist` | yes | Primary artist. |
| `album` | no | Used for matching, but not trusted alone. |
| `duration` | no | Seconds. Used for matching tolerance. |
| `prefer` | no | `word`, `synced`, or `any`. Default `word`. |
| `refresh` | no | If `1`, queue a background refresh even when cached. |

Cached success response:

```json
{
  "status": "found",
  "cache": "hit",
  "track": {
    "title": "Bohemian Rhapsody",
    "artist": "Queen",
    "album": "A Night at the Opera",
    "duration": 355
  },
  "lyricsType": "word",
  "source": "lyricsplus",
  "confidence": 0.96,
  "lines": [
    {
      "time": 12.3,
      "text": "Is this the real life?",
      "words": [
        { "time": 12.3, "endTime": 12.6, "text": "Is" }
      ]
    }
  ],
  "plainLyrics": "",
  "instrumental": false,
  "cachedAt": 1778767869057,
  "expiresAt": 1781359869057
}
```

Cold queued response:

```json
{
  "status": "queued",
  "cache": "miss",
  "message": "Lookup queued. Retry this request shortly.",
  "retryAfter": 15
}
```

Recent miss response:

```json
{
  "status": "not_found",
  "cache": "negative_hit",
  "retryAfter": 86400
}
```

### `GET /v1/search`

Optional v1.1 feature. Search cached records only at first.

Query params:

| Param | Required | Notes |
| --- | --- | --- |
| `q` | yes | Search text. |

### `POST /v1/refresh`

Queues a refresh. Public v1 can accept JSON body without auth only if abuse controls are in place from day one.

Initial policy:

- Accept only valid title and artist.
- Return `202` immediately.
- Deduplicate with a refresh lock.
- Add per-IP refresh limits before launch.
- Add API keys or Turnstile before opening broader public write access if abuse appears likely.

## Response Model

```ts
interface TrackForLyrics {
  title: string;
  artist: string;
  album: string;
  duration: number | null;
}

interface LyricWord {
  time: number;
  endTime: number;
  text: string;
}

interface LyricLine {
  time: number;
  text: string;
  words?: LyricWord[];
}

type LyricsType = "word" | "synced" | "plain" | "instrumental" | "none";
```

Use `lyricsType: "word"` when at least one line contains word timing. This is clearer for a public API than overloading `"synced"` for both line-level and word-level.

## Storage Plan

### D1 Tables

`lyrics`

```sql
CREATE TABLE lyrics (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL DEFAULT '',
  duration REAL,
  lyrics_type TEXT NOT NULL,
  source TEXT NOT NULL,
  provider_track_id TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 1,
  instrumental INTEGER NOT NULL DEFAULT 0,
  lines_json TEXT NOT NULL DEFAULT '[]',
  plain_lyrics TEXT NOT NULL DEFAULT '',
  synced_lyrics TEXT NOT NULL DEFAULT '',
  raw_ttml TEXT,
  raw_lrc TEXT,
  quality_flags_json TEXT NOT NULL DEFAULT '[]',
  cached_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_requested_at INTEGER,
  hit_count INTEGER NOT NULL DEFAULT 0
);
```

`lyrics_keys`

```sql
CREATE TABLE lyrics_keys (
  key TEXT PRIMARY KEY,
  lyrics_id TEXT NOT NULL,
  key_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (lyrics_id) REFERENCES lyrics(id)
);
```

Key types:

- `exact`: artist + title + album + rounded duration.
- `no_album`: artist + title + rounded duration.
- `no_duration`: artist + title + album.
- `simple`: artist + title.
- `provider`: provider + provider track ID.

`lookup_jobs`

```sql
CREATE TABLE lookup_jobs (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`provider_attempts`

```sql
CREATE TABLE provider_attempts (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  confidence REAL,
  rejected_reason TEXT,
  created_at INTEGER NOT NULL
);
```

Indexes:

```sql
CREATE INDEX idx_lyrics_expires_at ON lyrics(expires_at);
CREATE INDEX idx_lyrics_title_artist ON lyrics(title, artist);
CREATE INDEX idx_provider_attempts_key ON provider_attempts(canonical_key);
CREATE INDEX idx_lookup_jobs_status ON lookup_jobs(status, updated_at);
```

### KV Keys

KV is optional in v1 and should be used selectively for hot responses. D1 remains the durable authoritative cache. Avoid writing every successful lookup to KV on the free tier because write budget is tighter than read-heavy use cases.

```txt
lyrics:v1:{key} -> full JSON response
miss:v1:{key} -> recent miss marker
lock:v1:{key} -> short lookup lock
```

KV TTLs:

- Word-level hit: 30 days.
- Line-synced hit: 14 days.
- Plain hit: 7 days.
- Miss: 1 day.
- Lock: 60-180 seconds.

### Cloudflare Cache API

Use for GET response caching by normalized URL.

- Cache only successful `200` and recent `not_found` responses.
- Use `Cache-Control` headers.
- Treat Cache API as regional optimization only.
- Do not rely on it for durability.

## Cache Policy

| Result | D1 TTL | KV TTL | Notes |
| --- | ---: | ---: | --- |
| Word-level exact | 90 days | 30 days | Highest value. Refresh rarely. |
| Line-synced exact | 30 days | 14 days | Serve immediately; refresh for word-level in background. |
| Plain lyrics | 14 days | 7 days | Lower priority. |
| Instrumental | 30 days | 14 days | Stable if confidently matched. |
| Miss | 1-3 days | 1 day | Avoid provider hammering. |
| Suspicious match | Do not cache as found | none | Store attempt only. |

When a cached result is stale but usable:

- Return it immediately with `cache: "stale"`.
- Queue refresh in background.

## Lookup Flow

### Request Path

1. Validate query.
2. Normalize title, artist, album, and duration.
3. Build lookup keys.
4. Check Cloudflare Cache API.
5. Check KV.
6. Check D1 using all keys.
7. If fresh hit, return `200`.
8. If stale hit, return `200` and queue refresh.
9. If recent miss, return `not_found`.
10. If cold miss, acquire short lock.
11. Run a short live lookup budget of 2.5-3.5 seconds only if subrequest budget remains.
12. If a strong result arrives, store and return `200`.
13. If no strong result arrives, queue full lookup and return `202 queued`.

Request path budget:

- Keep the public request path under a small, explicit subrequest budget.
- Treat Cache API, KV, D1, Queue, and provider `fetch` calls as budgeted work.
- Do not fan out to all providers from the public request path.
- If budget is nearly exhausted, queue lookup instead of continuing live calls.

### Queue Path

1. Receive normalized track job.
2. Check D1 again to avoid duplicate work.
3. Run full provider pipeline with per-provider timeouts.
4. Score all candidates.
5. Store best accepted result or negative cache.
6. Write KV hot cache only when the response is high value or known hot.
7. Store provider attempt logs.

## Provider Stability Tiers

`stable`:

- LRCLIB. Public, documented, useful for line-synced and plain fallback. It does not provide word-level timing.

`experimental`:

- LRC.cx.
- LyricsPlus mirrors.
- SimpMusic.
- QQ Music.

Experimental providers must be:

- Configurable and easy to disable.
- Protected by strict timeouts.
- Benchmarked before changing priority.
- Accepted only after strict scoring and parser validation.
- Treated as unstable or reverse-engineered unless reliable public documentation is confirmed.

## Provider Pipeline

### Fast Live Lookup

Use only providers likely to return quickly and safely:

1. LRC.cx: word-level TTML or line LRC.
2. LyricsPlus: word-level TTML, strict timeout.
3. LRCLIB exact: stable line-synced fallback.

Return early if:

- Word-level result passes strict match and duration tolerance.
- Or line-synced result passes strict match and first-response budget is ending.

### Background Full Lookup

Run broader provider set:

1. LRC.cx.
2. LyricsPlus mirrors.
3. SimpMusic with strict candidate scoring.
4. QQ Music.
5. LRCLIB exact variants.
6. LRCLIB search.

Do not remove providers when adding new ones.

### Provider Timeouts

| Provider | Fast Path | Background |
| --- | ---: | ---: |
| LRC.cx | 2500ms | 5000ms |
| LyricsPlus | 3000ms | 6000ms |
| LRCLIB exact | 2000ms | 5000ms |
| LRCLIB search | skip | 5000ms |
| SimpMusic search + fetch | skip | 7000ms total |
| QQ Music search + fetch | skip | 7000ms total |

Use `AbortController` for every provider request.

## Matching And Ranking

Normalize text by:

- Lowercasing.
- Removing accents.
- Normalizing apostrophes and quotes.
- Removing common version suffixes.
- Tokenizing punctuation and separators.
- Treating `feat`, `ft`, `and`, `&` carefully.

Score factors:

| Factor | Weight |
| --- | ---: |
| Exact normalized title | high |
| Title token overlap | high |
| Artist token overlap | high |
| Duration closeness | medium |
| Album overlap | low/medium |
| Word-level timing | bonus |
| Line-synced timing | bonus |
| Suspicious version terms | strong penalty |

Reject if:

- Suspicious version term appears and title is not exact.
- Title score below threshold.
- Artist score below threshold.
- Duration difference exceeds tolerance for word-level.
- Line count too small.
- TTML/LRC parse fails.

Suspicious terms:

```txt
cover, instrumental, karaoke, live, lofi, made famous, marimba, mixed,
nightcore, piano, remix, ringtone, slowed, sped, tribute
```

Duration tolerances:

- Word-level: 3 seconds preferred, 5 seconds max if title/artist exact.
- Line-synced: 8 seconds preferred, 15 seconds max if title/artist exact.
- Plain: duration helps scoring but should not be mandatory.

## Provider Notes

### LyricsPlus

Use for word-level lyrics when a configured mirror is healthy.

Known useful mirror:

```txt
https://lyricsplus.prjktla.workers.dev
```

Risks:

- Mirror availability.
- Cloudflare free-tier request limit.
- Response shape may vary across mirrors.
- Public API stability is not guaranteed.

Policy:

- Use strict timeout.
- Cache successful word-level results aggressively in D1; write KV only for hot keys.
- Add mirrors as configuration, not hard-coded everywhere.
- Continue to next mirror if TTML is invalid.

### SimpMusic

Use only in background unless confidence is extremely high.

Risks:

- Search matching can return wrong songs.
- `richSyncLyrics` format needs parser validation.
- Public API stability is not guaranteed.

Policy:

- Search candidates.
- Score every candidate.
- Fetch selected candidate by ID/videoId.
- Accept only strict title/artist/duration matches.
- Never accept first result without scoring.

### LRCLIB

Reliable line-synced fallback.

Policy:

- Exact endpoint first.
- Search endpoint ranked after exact attempts.
- Use User-Agent.
- Cache line-synced results but refresh for possible word-level upgrade.

### LRC.cx

Useful existing word/line source.

Risks:

- Public API stability is not guaranteed.
- Response shape may change without notice.

Policy:

- Parse `lrc_ttml` into `lines[].words`.
- Fall back to `lrc` if no valid word-level TTML.
- Strict match and duration validation.
- Keep configurable so it can be disabled quickly.

### QQ Music

Fallback only.

Policy:

- Search and score candidates.
- Fetch lyrics only after candidate passes safety checks.
- Keep behind background pipeline or slow fallback.
- Treat as an unofficial/reverse-engineered provider unless official public API terms are confirmed.

## Rate Limit Strategy

Start free and simple:

- No account system in v1.
- Add per-IP soft limit for refresh requests before launch.
- Use Cloudflare WAF/rate limiting if free dashboard options are enough.
- If needed, add lightweight API keys stored in D1.

Provider protection from day one:

- Cache hits before provider calls.
- Negative cache.
- Lookup lock.
- Queue dedupe.
- Short live lookup budget.
- Conservative provider timeouts.

## CORS Policy

For public use:

```txt
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

If abuse starts, restrict POST refresh first. Keep GET open if possible.

## Repository Structure

Planned structure:

```txt
lyrixa/
  docs/
    implementation-plan.md
  migrations/
    0001_initial.sql
  src/
    index.ts
    routes/
      health.ts
      lyrics.ts
      refresh.ts
      search.ts
    lib/
      cache.ts
      cors.ts
      db.ts
      http.ts
      keys.ts
      normalize.ts
      ranking.ts
      response.ts
      time.ts
    providers/
      index.ts
      lrc-cx.ts
      lrclib.ts
      lyricsplus.ts
      qq-music.ts
      simpmusic.ts
    parsers/
      lrc.ts
      ttml.ts
      rich-sync.ts
    queue/
      lookup.ts
  package.json
  bun.lock
  tsconfig.json
  wrangler.jsonc
```

## TypeScript And Bun Plan

Use TypeScript across the whole project.

Use Bun for:

- Installing dependencies.
- Running local scripts.
- Running provider benchmarks.
- Running test helpers.

Use Wrangler for:

- Running the Worker locally.
- Applying D1 migrations.
- Creating D1, KV, and Queue resources.
- Deploying to Cloudflare.

Important runtime rule:

- Production Worker code must stay compatible with Cloudflare `workerd`.
- Do not use Bun-only APIs inside `src/` Worker code.
- Bun-only APIs are allowed in `scripts/`, benchmark tooling, and local utilities that do not ship to the Worker.

Planned `package.json` scripts:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "bench:providers": "bun run scripts/bench-providers.ts",
    "db:migrate:local": "wrangler d1 migrations apply lyrics_api --local",
    "db:migrate:remote": "wrangler d1 migrations apply lyrics_api --remote"
  }
}
```

Preferred install commands:

```txt
bun install
bun add -d typescript wrangler @cloudflare/workers-types
```

If a dependency is used by Worker runtime code, verify it is ESM-compatible and Cloudflare Workers-compatible before adding it. Prefer small internal helpers over large runtime dependencies.

## Wrangler Plan

Initial `wrangler.jsonc` should define:

- Worker name.
- Compatibility date.
- D1 database binding.
- KV namespace binding.
- Queue producer and consumer.

Example shape:

```jsonc
{
  "name": "lyrixa",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-14",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "lyrics_api",
      "database_id": "replace-after-create"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "LYRICS_KV",
      "id": "replace-after-create"
    }
  ],
  "queues": {
    "producers": [
      { "binding": "LOOKUP_QUEUE", "queue": "lyrics-lookup" }
    ],
    "consumers": [
      { "queue": "lyrics-lookup", "max_batch_size": 5, "max_batch_timeout": 10 }
    ]
  }
}
```

## Build Phases

### Phase 1: Minimal Public API

- Scaffold Worker TypeScript project.
- Add `/health`.
- Add CORS.
- Add request validation and normalized keys.
- Add D1 migration.
- Add D1 read/write helpers.
- Add cache-only `GET /v1/lyrics`.
- Add `POST /v1/refresh` that queues a job.
- Add queue consumer stub that writes negative cache for now.

Acceptance:

- Local `wrangler dev` runs.
- `/health` returns `200`.
- Invalid requests return `400`.
- Cold lookup queues a job and returns `202`.

### Phase 2: LRCLIB + Current Parser Baseline

- Implement normalization and scoring from the portfolio app.
- Implement LRC parser.
- Implement LRCLIB exact provider.
- Store synced lyrics in D1.
- Write KV hot cache selectively for high-value responses.
- Return cached line-synced lyrics.

Acceptance:

- Known LRCLIB songs return cached synced lines after queue completion.
- Recent misses are not retried on every request.

### Phase 3: Word-Level Support

- Implement TTML parser from portfolio logic.
- Add LRC.cx provider.
- Add LyricsPlus provider with mirror configuration.
- Return `lyricsType: "word"` when words exist.
- Prefer word-level over line-level when confidence is safe.

Acceptance:

- Word-level sample returns `lines[].words`.
- Existing line-synced cache can be upgraded to word-level.

### Phase 4: Better Provider Coverage

- Add SimpMusic search/fetch with strict matching.
- Add `richSyncLyrics` parser after format validation.
- Add QQ Music fallback.
- Add provider attempt logs.

Acceptance:

- Known SimpMusic false positives are rejected.
- Provider timings and rejection reasons are stored.

### Phase 5: Public Hardening

- Add lightweight per-IP rate hints or Cloudflare WAF guidance.
- Add docs for public usage.
- Add OpenAPI spec.
- Add basic integration tests with mocked provider responses.
- Add `/v1/search` against cached D1 rows.

Acceptance:

- API can be shared publicly with clear limits and no surprise live-provider hammering.

## Testing Plan

Use fixed test tracks:

- `Bohemian Rhapsody - Queen`: expected word-level from LyricsPlus.
- `Shape of You - Ed Sheeran`: expected word-level candidate.
- `Blinding Lights - The Weeknd`: SimpMusic false positive guard.
- `Lose Yourself - Eminem`: SimpMusic false positive guard.
- `Levitating - Dua Lipa`: remix/version guard.

Test categories:

- Parser tests: LRC, TTML, rich sync.
- Ranking tests: exact, partial, suspicious, duration mismatch.
- Cache tests: fresh hit, stale hit, miss hit, alternate key hit.
- Route tests: validation, CORS, queued response, cached response.
- Queue tests: dedupe, retry, successful upsert, negative cache.

## Provider Benchmark Script

Add a local-only benchmark script so we can test every provider, compare hit quality, and measure average response time before changing provider order.

Planned command:

```txt
bun run bench:providers
```

Optional command flags:

```txt
bun run bench:providers -- --provider=lrclib
bun run bench:providers -- --limit=10
bun run bench:providers -- --timeout=5000
bun run bench:providers -- --json
bun run bench:providers -- --no-cache
```

Script path:

```txt
scripts/bench-providers.ts
```

### Benchmark Goals

- Measure average response time per provider.
- Measure median, p90, fastest, and slowest response time.
- Count successful hits, misses, timeouts, parse failures, and rejected matches.
- Count word-level, line-synced, plain, instrumental, and none results.
- Catch false positives by running known bad-match cases.
- Produce a report that helps tune provider priority and timeout values.

### Providers To Benchmark

Initial providers:

- LRC.cx.
- LyricsPlus mirrors.
- SimpMusic.
- LRCLIB exact.
- LRCLIB search.
- QQ Music.

Benchmark LyricsPlus mirrors separately, because one mirror can be much slower or rate-limited while another is healthy.

Example provider labels:

```txt
lrc-cx
lyricsplus:prjktla
lyricsplus:atomix
lyricsplus:vercel-seven
simpmusic
lrclib:get
lrclib:search
qq-music
```

### Sample Track Set

Keep the default benchmark small to avoid abusing free upstream providers.

Default set: 10-20 tracks.

Include:

- Popular English songs.
- Vietnamese songs if the app needs them.
- Long songs.
- Short songs.
- Tracks with remasters/live/remix risk.
- Known SimpMusic false positives.

Initial fixture path:

```txt
fixtures/provider-benchmark-tracks.json
```

Example fixture:

```json
[
  {
    "title": "Bohemian Rhapsody",
    "artist": "Queen",
    "album": "A Night at the Opera",
    "duration": 355,
    "expect": ["word", "synced"]
  },
  {
    "title": "Shape of You",
    "artist": "Ed Sheeran",
    "album": "Divide",
    "duration": 234,
    "expect": ["word", "synced"]
  },
  {
    "title": "Blinding Lights",
    "artist": "The Weeknd",
    "album": "After Hours",
    "duration": 200,
    "rejectExamples": ["City of Blinding Lights"]
  },
  {
    "title": "Lose Yourself",
    "artist": "Eminem",
    "album": "8 Mile",
    "duration": 326,
    "rejectExamples": ["Don't Lose Yourself"]
  }
]
```

### Metrics

For each provider, collect:

| Metric | Meaning |
| --- | --- |
| `requests` | Number of track requests attempted. |
| `hits` | Accepted results. |
| `misses` | Provider returned no usable result. |
| `timeouts` | Request exceeded provider timeout. |
| `errors` | Network or response errors. |
| `parseFailures` | Response existed but parser failed. |
| `rejected` | Candidate found but failed scoring/safety checks. |
| `wordHits` | Accepted results with `lines[].words`. |
| `syncedHits` | Accepted line-synced results. |
| `plainHits` | Accepted plain lyrics only. |
| `falsePositiveWarnings` | Candidate matched known wrong title or suspicious version. |
| `avgMs` | Average response time. |
| `medianMs` | Median response time. |
| `p90Ms` | 90th percentile response time. |
| `minMs` | Fastest response. |
| `maxMs` | Slowest response. |

### Output

Console summary:

```txt
Provider              Req  Hit  Word  Sync  Plain  Miss  T/O  Reject  Avg   P90
lrc-cx                20   16   8     8     0      4     0    2       820   1600
lyricsplus:prjktla    20   19   19    0     0      1     0    0       1150  2400
simpmusic             20   13   7     6     0      7     1    5       980   2100
lrclib:get            20   18   0     18    0      2     0    0       430   900
lrclib:search         20   19   0     19    0      1     0    1       620   1200
qq-music              20   12   0     12    0      8     2    3       1800  4500
```

JSON report path:

```txt
reports/provider-benchmark-YYYY-MM-DD.json
```

Markdown report path:

```txt
reports/provider-benchmark-YYYY-MM-DD.md
```

### Benchmark Safety

The script must be polite by default:

- Default to a small fixture set.
- Limit concurrency to 1-2 per provider.
- Add a small delay between requests.
- Use provider timeouts.
- Do not run automatically in CI unless explicitly enabled.
- Do not repeatedly benchmark all providers during development.
- Cache raw benchmark responses locally unless `--no-cache` is passed.

Local benchmark cache path:

```txt
.bench-cache/{provider}/{track-key}.json
```

Default behavior:

- Use `.bench-cache` if the cached response is less than 24 hours old.
- Still report cached vs live timings separately.
- Do not write benchmark cache into production D1/KV.

### Benchmark Result Shape

Each provider run should produce records like:

```json
{
  "provider": "lyricsplus:prjktla",
  "track": {
    "title": "Bohemian Rhapsody",
    "artist": "Queen",
    "album": "A Night at the Opera",
    "duration": 355
  },
  "status": "hit",
  "lyricsType": "word",
  "durationMs": 1182,
  "confidence": 0.97,
  "lineCount": 86,
  "wordCount": 412,
  "sourceTitle": "Bohemian Rhapsody",
  "sourceArtist": "Queen",
  "rejectedReason": null,
  "cached": false
}
```

### Implementation Notes

- Reuse the same provider modules as production code.
- Reuse production parsers and ranking logic.
- Do not create benchmark-only provider parsing logic.
- The benchmark should call providers individually, not through the normal aggregate lookup pipeline.
- Include per-track detail so bad matches are easy to debug.
- Add a `--compare` mode later to compare two reports and detect provider regressions.

### How Benchmark Data Should Influence The API

Use benchmark data to tune:

- Fast-path provider list.
- Provider timeout values.
- Background provider order.
- Whether SimpMusic should remain background-only.
- Whether a LyricsPlus mirror should be disabled or moved down.
- Cache TTLs for expensive/high-value providers.

## Free-Tier Constraints

Cloudflare Workers free-tier constraints to design around:

- Daily Worker request limits can apply.
- Concurrent outgoing connection limit is 6 per invocation.
- Worker invocations have a subrequest limit; Cache API, KV, D1, Queue, and outbound `fetch` calls all need to be budgeted.
- KV is eventually consistent and should be read-heavy/selectively written on the free tier.
- Cache API is regional, not globally replicated.
- `waitUntil` is best-effort and limited after response; do not rely on it for required provider lookup work.
- Queues are the reliable background mechanism.

Design response:

- Keep live path short.
- Use queue for full lookup.
- Deduplicate jobs.
- Cache aggressively in D1 and Cache API; use KV selectively for hot responses.
- Do not do six provider calls in the public request path.

## Deployment Commands

Planned commands after scaffolding:

```txt
bun create cloudflare@latest lyrixa
bun install
npx wrangler d1 create lyrics_api
npx wrangler kv namespace create LYRICS_KV
npx wrangler queues create lyrics-lookup
npx wrangler d1 migrations apply lyrics_api --local
bunx wrangler dev
bunx wrangler deploy
```

Exact commands may change based on the generated Cloudflare template.

## Open Questions

- Should the public response include raw provider payloads? Default no.
- Should `POST /v1/refresh` be public from day one? Default yes, but deduped and conservative.
- Should we expose provider source by default? Default yes for transparency.
- Should lyrics be cacheable indefinitely if manually verified later? Yes, add `manual_verified` flag later.

## First Implementation Slice

When implementation starts, do this first:

1. Scaffold Worker TypeScript project.
2. Add D1 migration.
3. Implement normalized key generation.
4. Implement cache-only lookup route.
5. Implement queue producer and consumer.
6. Implement LRCLIB provider in queue path.
7. Verify with local D1.

Do not start by adding every provider. Get the cache/queue contract right first.
