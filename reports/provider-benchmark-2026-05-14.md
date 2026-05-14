# Provider Benchmark - 2026-05-14

## Environment

- Runtime: Bun local benchmark script.
- Fixture: `fixtures/provider-benchmark-tracks.json` with 30 tracks across English, Spanish, Korean, Italian, Portuguese, rock, pop, hip-hop, soul, funk, dance, K-pop, and reggaeton.
- Classifier: strict parsed-content classifier.
- Concurrency: 3.
- Hit definition: provider returns parsed lyrics, classified type is valid, and metadata checks pass where source metadata exists.

## Classification Rules

- `word`: at least one parsed `LyricLine` contains `words` with timing.
- `synced`: parsed timed lines exist, but no word timings exist.
- `plain`: plain lyric text exists, but no timed lines exist.
- `instrumental`: provider explicitly marks instrumental.
- `none`: no usable lyric content.

LRCLIB does not provide word-level timing and should never be counted as `word`. LyricsPlus `/v1/ttml/get` can provide TTML with word/syllable spans and is counted as `word` only after parsing those spans into `lines[].words`.

## All-Provider Benchmark

Command:

```txt
bun scripts/bench-providers.ts --provider=all --limit=30 --concurrency=3
```

Summary:

```txt
Provider              Req  Hit  Word  Sync  Plain  Miss  Err  T/O  Reject  Avg   P90
lrc-cx               30  0   0    0    0     0    30   0   0      9    1
lyricsplus:prjktla   30  22  22   0    0     1    7    0   0      549  1175
simpmusic            30  0   0    0    0     0    30   0   0      142  196
lrclib:get           30  20  0    19   1     8    0    2   0      9753 12963
lrclib:search        30  24  0    24   0     3    0    3   0      9919 12198
qq-music             30  0   0    0    0     30   0    0   0      85   85
```

## LRCLIB Search Timeout Check

Command:

```txt
bun scripts/bench-providers.ts --provider=lrclib:search --limit=30 --concurrency=3 --timeout=12000
```

Summary:

```txt
Provider              Req  Hit  Word  Sync  Plain  Miss  Err  T/O  Reject  Avg   P90
lrclib:search        30  21  0    21   0     3    0    6   0      9378 12010
```

At 12 seconds, LRCLIB search lost 3 hits compared with the 15-second background timeout. Use 15 seconds in background jobs when quality matters; do not use LRCLIB search in the fast public request path.

## Provider Findings

### LyricsPlus

- Working endpoint: `GET https://lyricsplus.prjktla.workers.dev/v1/ttml/get`.
- Response: JSON containing `ttml`.
- Quality: best word-level source in this run.
- Coverage: 22 accepted word hits from 30 tracks.
- Speed: average 549ms, p90 1175ms in this run.
- Risks: returned `429` and `503` under benchmark load; should be used conservatively and cached aggressively.

### LRCLIB Exact

- Working endpoint: `GET https://lrclib.net/api/get`.
- Response: JSON containing `plainLyrics` and sometimes `syncedLyrics`.
- Quality: good synced fallback, no word-level timing.
- Coverage: 20 accepted hits from 30 tracks.
- Speed: average 9753ms, p90 12963ms.

### LRCLIB Search

- Working endpoint: `GET https://lrclib.net/api/search`.
- Response: array of candidate records containing `plainLyrics` and sometimes `syncedLyrics`.
- Quality: best LRCLIB coverage, no word-level timing.
- Coverage: 24 accepted synced hits from 30 tracks at 15 seconds.
- Speed: average 9919ms, p90 12198ms.

### LRC.cx

- Current adapter endpoint is not working.
- Result: connection/DNS-style failure for every track.
- Action: disable until a verified endpoint is found.

### SimpMusic

- Current adapter endpoint is not working.
- Result: `405` for every track.
- Action: disable until the real search/fetch API contract is implemented.

### QQ Music

- Signed search responds quickly, but the adapter does not fetch or parse lyrics yet.
- Result: quick misses for every track.
- Action: keep low timeout until lyric fetch and QRC parsing are implemented.

## Recommended Timeouts

| Provider | Fast Path | Background | Status |
| --- | ---: | ---: | --- |
| LyricsPlus | 3000ms | 9000ms | enabled, cache aggressively |
| LRCLIB exact | 8000ms or skip | 15000ms | background fallback |
| LRCLIB search | skip | 15000ms | background fallback, better coverage than exact |
| QQ Music | 1000ms | 2000ms | search only until lyric fetch implemented |
| LRC.cx | 1000ms | 1000ms | disabled until verified |
| SimpMusic | 1000ms | 1000ms | disabled until verified |

## API Strategy Impact

- Public request path should not fan out to all providers.
- Best fast path candidate is LyricsPlus with a 3000ms budget for possible word-level hits.
- Full queue/background lookup should run LyricsPlus first, then LRCLIB search for synced fallback.
- LRCLIB should be treated as high-coverage but slow; queue is the right place for it.
- All accepted results should be cached in D1; word-level hits should be cached most aggressively.
