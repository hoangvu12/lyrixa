# Lyrixa

Lyrixa is a cache-first lyrics API built on Cloudflare Workers and D1.

It returns word-level lyrics when available. If the word-level provider is unavailable, it can return synced line-level lyrics as a short-lived fallback.

## API

### Health

```txt
GET /health
```

### Get Lyrics

```txt
GET /v1/lyrics?title=Bohemian%20Rhapsody&artist=Queen&duration=354
```

The API checks D1 first. On a cache miss, it tries live providers and stores the result.

Possible responses:

- `200` with lyrics
- `404` when no lyrics are found
- `503` when providers are unavailable

### Refresh Lyrics

```txt
POST /v1/refresh
Content-Type: application/json

{
  "title": "Bohemian Rhapsody",
  "artist": "Queen",
  "duration": 354
}
```

Refresh does a slower lookup and updates the cache.

### Search Cached Lyrics

```txt
GET /v1/search?q=queen
```

Search reads from cached lyrics only.

## Cache Rules

- Word-level lyrics are cached for 90 days.
- Synced lyrics are cached for 30 days.
- Plain lyrics are cached for 14 days.
- Negative results are cached for 1 day.
- Temporary synced fallbacks are cached for 6 hours.

## Local Development

```txt
bun install
bun run db:migrate:local
bun run dev
```

Run typecheck:

```txt
bun run typecheck
```

Run the 30-track API smoke test:

```txt
bun scripts/test-api-fixture.ts --concurrency=5
```

## Deploy

Create a Cloudflare D1 database, set the database ID in `wrangler.jsonc`, run remote migrations, then deploy:

```txt
bun run db:migrate:remote
bun run deploy
```
