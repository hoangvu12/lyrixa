# Expanded Provider Benchmark - 2026-05-15

## Fixture

- Expanded `fixtures/provider-benchmark-tracks.json` from 30 to 96 tracks.
- Coverage now includes English pop/rock/hip-hop, Latin, Brazilian Portuguese, French, German, Romanian, Japanese, Korean, Mandarin, Italian, Hindi/Bollywood, Arabic, African/Afrobeats, instrumental/classical, and repetitive/minimal-lyric tracks.
- Benchmark expectation handling was relaxed: if a track can accept `word`, then `synced` and `plain` are also acceptable; if it can accept `synced`, `plain` is also acceptable. This matches the product goal that any lyric type is useful.

## New Providers Tested

Added plain fallback benchmark adapters:

- `genius`
- `lyrics.ovh`
- `vagalume`
- `chartlyrics`

These are currently benchmark-integrated; they are not yet wired into the production lookup path.

## Results

### Lyrics.ovh Full Expanded Fixture

Command:

```txt
bun scripts/bench-providers.ts --provider=lyrics.ovh --limit=100 --timeout=5000 --concurrency=4
```

Summary:

```txt
Provider              Req  Hit  Word  Sync  Plain  Miss  Err  T/O  Reject  Avg   P90
lyrics.ovh           96  67  0    0    67    27   0    2   0      419  576
```

Finding:

- Very useful plain fallback.
- Fast and simple.
- Misses are concentrated around some Latin, CJK, Arabic/African, instrumentals, and newer catalog edge cases.

### Genius Broad Sample

Command:

```txt
bun scripts/bench-providers.ts --provider=genius --limit=60 --timeout=8000 --concurrency=3
```

Summary:

```txt
Provider              Req  Hit  Word  Sync  Plain  Miss  Err  T/O  Reject  Avg   P90
genius               60  48  0    0    48    12   0    0   0      1818 3409
```

Finding:

- Strong plain fallback, especially Western mainstream and many international tracks.
- Slower than Lyrics.ovh because it searches and fetches lyric pages.
- Some misses on older Italian/Portuguese variants, Korean group tracks, and Mandarin romanized/translated titles.

### LRCLIB Expanded Sample

Command:

```txt
bun scripts/bench-providers.ts --provider=lrclib:search --limit=60 --timeout=15000 --concurrency=2
```

Summary:

```txt
Provider              Req  Hit  Word  Sync  Plain  Miss  Err  T/O  Reject  Avg   P90
lrclib:search        60  51  0    48   3     8    0    1   0      9754 12217
```

Finding:

- Still the best safe synced fallback.
- Excellent expanded coverage but slow enough to remain background-only.
- Strong on Japanese/Korean samples in this slice, weaker on some older Brazilian/Mandarin variants.

### LyricsPlus Expanded Sample

Command:

```txt
bun scripts/bench-providers.ts --provider=lyricsplus:prjktla --limit=60 --timeout=10000 --concurrency=2
```

Summary:

```txt
Provider              Req  Hit  Word  Sync  Plain  Miss  Err  T/O  Reject  Avg   P90
lyricsplus:prjktla   60  5   5    0    0     0    55   0   0      275  89
```

Finding:

- Produced word-level hits immediately, then hit `429` for nearly every later request.
- Treat `429` as a normal miss/unavailable condition, not a hard provider error.
- Best used with very conservative fanout, request coalescing, and aggressive cache.

### Vagalume and ChartLyrics Sample

Command:

```txt
bun scripts/bench-providers.ts --provider=genius,vagalume,lyrics.ovh,chartlyrics --limit=20 --timeout=8000 --concurrency=2
```

Observed:

- `vagalume`: `503` for all 20 requests from this environment.
- `chartlyrics`: timed out for all 20 requests at 8 seconds.

Finding:

- Keep adapters for future manual checks, but do not put either in the default lookup chain now.

## Product Recommendation

Default lookup order should prioritize quality while falling back to broad plain coverage:

1. Cache/D1/KV.
2. `lyricsplus:prjktla` for word-level, with tight rate protection.
3. `lrclib:search` in background for synced/plain.
4. `lyrics.ovh` as fast plain fallback.
5. `genius` as slower plain fallback.
6. Experimental regional providers: QQ, NetEase, Kugou, Kuwo, PetitLyrics.

Do not include `vagalume` or `chartlyrics` in production lookup until they work reliably from the deployment environment.

## Ranking And Fallback Behavior

- Provider results are now ranked by `lyricsType`, provider trust, provider confidence, metadata match, and content depth.
- `word` outranks `synced`, `synced` outranks `plain`, and explicit `instrumental` remains high value.
- Plain results are treated as temporary fallbacks so they receive shorter fallback TTLs and can be replaced by better synced/word results later.
- Live lookup remains staged: `lyricsplus` is tried first for word-level data, then fallback providers are ranked together.
- Fast mode can return `lyrics.ovh` plain lyrics when stronger providers miss or time out.
- Background mode can also use `genius` as the slower plain fallback.
- `vagalume` and `chartlyrics` remain benchmark-only and are not part of live fallback ranking.

## Follow-ups

- Add offset/range support to `bench-providers.ts` so regional slices can be benchmarked without waiting through the whole fixture prefix.
- Add union coverage reporting across provider sets, not just per-provider metrics.
- Wire `lyrics.ovh` and `genius` into background lookup after synced providers.
- Implement NetEase/QQ/Kugou next for CJK/karaoke coverage.
