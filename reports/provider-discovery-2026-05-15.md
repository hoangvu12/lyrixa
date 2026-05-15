# Provider Discovery - 2026-05-15

## Goal

Find as many practical lyrics providers as possible to improve coverage across plain, line-synced, word-level, karaoke, translated, romanized, and instrumental lyrics.

## Current Baseline

- `lyricsplus:prjktla`: best current word-level source, but can rate-limit.
- `lrclib:get` and `lrclib:search`: best safe synced/plain fallback, but slow.
- `simpmusic`: now uses the real API and can return word-level rich sync, but coverage and rate limits are weak.
- `qq-music`: search exists, lyric fetch/QRC parsing is not implemented yet.
- `lrc-cx`: current endpoint still needs re-verification.

## Recommended Build Queue

| Priority | Provider | Types | Why | Risk | Implementation Notes |
| --- | --- | --- | --- | --- | --- |
| P0 | Local import | plain, LRC, TTML | Highest reliability and no provider risk | Low | Accept `.lrc` and `.ttml` first; later add `.qrc`, `.krc`, `.yrc` import if decoders exist. |
| P0 | LRCLIB DB dumps | plain, synced, instrumental | Avoids slow live lookups and improves cache seeding | Low | Ingest dumps offline/background instead of calling live API for popular tracks. |
| P1 | Genius | plain | Huge Western coverage | Medium | Use official/search APIs for metadata where possible; full lyrics generally require page extraction, so keep as fallback. |
| P1 | Vagalume | plain, translations | Strong Portuguese/Brazil coverage | Medium | Useful regional fallback for Brazilian/Latin catalogs. |
| P1 | Lyrics.ovh | plain | Very simple fallback | Medium | Low confidence, last-resort source only. |
| P1 | ChartLyrics | plain | Old but easy fallback | Medium | SOAP/XML style endpoint; useful only after stronger sources miss. |
| P2 | NetEase Cloud Music | LRC, translated, romanized, YRC/KRC-style rich lyrics | Strong CJK and global catalog | High | Start with older lyric endpoint; richer endpoints need encrypted EAPI/cookies. Reference: `Binaryify/NeteaseCloudMusicApi`, `chenmozhijin/LDDC`. |
| P2 | QQ Music | LRC, QRC, translations, romanization | Strong CJK and karaoke coverage | High | Implement `musicu.fcg` lyric fetch and QRC decoder. Reference: `chenmozhijin/LDDC`, `jsososo/QQMusicApi`, `xmcp/QRCD`. |
| P2 | Kugou | LRC, KRC word/karaoke | Strong Chinese karaoke lyrics | High | Two-step search/download, then KRC decrypt/decompress/parse. Reference: `chenmozhijin/LDDC`, `ddddxxx/LyricsKit`. |
| P2 | Kuwo | synced-ish line lyrics | Simpler Chinese fallback than QQ/Kugou | Medium-high | Endpoint examples use `songinfoandlrc?musicId=...`; needs referer/cookie testing. |
| P2 | PetitLyrics | Japanese plain/synced | Valuable J-pop/anime niche | Medium-high | Use only if a stable API path is verified; otherwise scraping risk is high. |
| P3 | JioSaavn | plain | India catalog fallback | High | Many unofficial APIs exist, but ToS/reliability is poor. Keep experimental. |
| P3 | Deezer GraphQL lyrics | plain, synced, word-ish | Good global catalog where available | High | Requires web auth/JWT/private GraphQL; not a default provider. |
| P3 | YouTube Music lyrics | plain, sometimes synced | Global catalog bridge | High | Use `videoId`/browse lyrics when available. Needs YT auth/header handling and strict matching. |

## Licensed / Commercial Options

| Provider | Types | Notes |
| --- | --- | --- |
| Musixmatch official | plain, synced/rich sync depending license | Best known coverage if licensed. Public/free API is too limited for broad rich lyrics. |
| LyricFind | plain/synced depending contract | Production-safe if budget exists. |
| Gracenote / TiVo | metadata and possibly lyrics depending product | Enterprise route. |
| MusicStory | lyrics/metadata depending contract | Regional/commercial option. |

## Avoid As Default

| Provider | Reason |
| --- | --- |
| Spotify color lyrics | Private endpoint, requires Spotify auth/session, high breakage and ToS risk. |
| Apple Music TTML | High-value TTML but auth/private-access heavy; not a public API surface. |
| Musixmatch unofficial | Excellent data, but private tokens/device flows and copyright risk. |
| AZLyrics | Scraping/anti-bot only, plain lyrics only. |
| Tidal/Amazon/Anghami/Boomplay native lyrics | No reliable public lyric APIs found. |

## GitHub References

- `spicetify/cli/CustomApps/lyrics-plus`: provider map for Spotify, Musixmatch, NetEase, LRCLIB, Genius, local lyrics.
- `chenmozhijin/LDDC`: strongest reference for QQ, NetEase, Kugou, LRCLIB, precise lyrics matching, and karaoke formats.
- `Binaryify/NeteaseCloudMusicApi`: NetEase API implementation, including lyric endpoints.
- `NeteaseCloudMusicApiEnhanced/api-enhanced`: maintained continuation/revival of NetEase API work.
- `jsososo/QQMusicApi` and `metowolf/TencentMusicApi`: QQ/Tencent Music API references.
- `xmcp/QRCD`: QRC decode/reference implementation.
- `ddddxxx/LyricsKit`: Apple platform lyrics toolkit with Chinese provider references.
- `lbr77/apple-music-api`: Apple Music TTML fetch and conversion reference.
- `OrfiDev/orpheusdl-musixmatch`: Musixmatch rich/synced handling reference.
- `Wilooper/Lyrica`: self-hosted aggregator using YouTube Music, LRCLIB, Genius, Lyrics.ovh, ChartLyrics, LyricsFreek.
- `spotDL` lyrics provider docs: uses `syncedlyrics` sources such as Deezer and NetEase plus Genius.

## Format Targets

| Format | Providers | Parser Need |
| --- | --- | --- |
| Plain text | Genius, Vagalume, Lyrics.ovh, ChartLyrics, JioSaavn, PetitLyrics | Normalize line breaks and strip annotations. |
| LRC | LRCLIB, NetEase, Kugou, Kuwo, QQ fallback | Existing parser mostly sufficient. |
| TTML | LyricsPlus, Apple/Musixmatch references, local import | Existing parser exists; preserve raw TTML when possible. |
| QRC | QQ Music | Need decrypt/decode and word/character segment parser. |
| KRC | Kugou | Need base64/decrypt/decompress and timing parser. |
| YRC | NetEase | Need rich timing parser. |

## Strategy

1. Keep public requests cache-first and queue-based. Do not fan out live to every provider.
2. Add low-risk plain fallbacks first because any type of lyrics is acceptable.
3. Add regional CJK providers as opt-in/background enrichers because they provide the best karaoke coverage but carry private API risk.
4. Store raw provider payloads for QRC/KRC/YRC/TTML where legally acceptable so parser fixes can reprocess cached data.
5. Score provider trust separately from match confidence. Unofficial/private providers should not outrank safer providers unless the match and lyric quality are clearly better.

## Best Next Implementation Steps

1. Add `genius`, `vagalume`, `lyrics-ovh`, and `chartlyrics` as plain fallback providers.
2. Fix/finish `qq-music` lyric fetch and implement QRC parsing behind an experimental flag.
3. Add NetEase basic LRC provider before encrypted rich lyric support.
4. Add Kugou LRC first, then KRC parsing.
5. Add LRCLIB dump ingestion to seed D1 and reduce slow live calls.

## Second Discovery Pass

Additional subagent/GitHub research found more candidates. These are not all recommended for production, but they are useful to track.

### Newly Interesting Candidates

| Priority | Provider | Types | Why | Risk | References |
| --- | --- | --- | --- | --- | --- |
| P1 | `syncedlyrics`/Megalobiz | LRC, plain | Existing Python library already aggregates multiple synced sources; Megalobiz can provide direct LRC hits. | High scraping/licensing risk | `moehmeni/syncedlyrics`, `kkpanaz/music-lrc-lyrics` |
| P1 | Deezer private lyrics | synced JSON, plain | Good global catalog where Deezer has lyrics; response can convert to LRC. | High private endpoint/auth risk | `mirsella/deezer-lyrics`, `Glebsin/Deezer-synced-lyrics-extractor`, `tappyduckmancodes/multiplatform-lyric-downloader` |
| P1 | YouTube captions | WebVTT/SRV3/SRT-like | Global fallback for official lyric/karaoke videos and captions. | Medium-high; not always official lyrics | `better-lyrics/cf-api`, YouTube caption tooling |
| P2 | VocaDB / UtaiteDB | metadata, lyrics/translation fields | Clean public API for Vocaloid/utaite/anime-adjacent discovery and alternate titles. | Medium; lyric redistribution rights still unclear | `https://vocadb.net/swagger/index.html` |
| P2 | Karaoke Mugen / KaraDB | ASS, SRT, Ultrastar/KAR subtitles | Strong anime/karaoke niche and local/event catalog integration. | Medium; not a general catalog | `KaraokeMugen/karaokemugen-app`, `api.karaokes.moe` |
| P2 | JioSaavn unofficial | plain | Best Hindi/Bollywood/Indian regional fallback found. | High unofficial API risk | `tuhinpal/JiosaavnAPI`, `adityaprakashgupta/Jio-Saavn-API`, `sarthak090/jiosavan-api` |
| P2 | Letras.mus.br | plain | Strong PT-BR and Latin catalog fallback beyond Vagalume. | High scraping risk | lyric scraper/API repos and site search/page patterns |
| P2 | Tekstowo | plain | Polish/Eastern Europe fallback. | High scraping risk | `pawel-talar/tekstowo`, `TUVIMEN/lyryx` |
| P3 | Regional lyric sites | plain | French/German/Italian/Arabic/Russian long-tail coverage. | Very high scraper maintenance/legal risk | Paroles.net, Songtexte.com, AngoloTesti, Letras, text-pesni style sites |
| P3 | TIDAL private lyrics | TTML | High-quality synced/TTML when available. | High private auth risk | `Fokka-Engineering/TIDAL`, Tidal downloader issue references |

### Commercial / Licensed Candidates

| Provider | Value | Notes |
| --- | --- | --- |
| LyricFind | Production-safe static, line-synced, and word-synced lyrics | Best legal-first option if budget exists; sales-led access. |
| Musixmatch Pro | Licensed lyrics, subtitles, translations, richsync | Best documented licensed developer path; richsync requires enterprise plan. |
| Gracenote | Canonical metadata, not primarily lyrics | Useful for matching/enrichment, not a lyrics source. |
| AudD / ACRCloud / ShazamKit | Audio recognition | Useful for identifying songs before lyric lookup; not lyric providers. |

### Updated Candidate Ranking

Most worth testing next:

1. NetEase basic LRC and rich YRC later.
2. QQ lyric fetch and QRC parser.
3. Kugou LRC/KRC.
4. Megalobiz via a small direct scraper or by studying `syncedlyrics`.
5. YouTube captions for official lyric/karaoke videos.
6. JioSaavn for Hindi/Bollywood plain fallback.
7. VocaDB for Vocaloid/anime metadata and alternate title matching.
8. Deezer private lyrics only if we accept private endpoint risk.

Not worth default implementation right now:

- Broad regional HTML scrapers unless a specific language gap becomes painful.
- TIDAL private lyrics, Spotify private lyrics, Apple private TTML without user/auth/legal clarity.
- Research datasets such as DALI/HSD/DAMP for production fetching; useful for evaluation only.

## Third Discovery Pass

Deeper searches through desktop music-player plugins, package registries, regional scraper projects, and karaoke/subtitle ecosystems found additional long-tail candidates.

### General Plain / Legacy Providers

| Provider | Types | Endpoint / Pattern | Value | Risk | References |
| --- | --- | --- | --- | --- | --- |
| SongLyrics.com | plain | `https://songlyrics.com/{artist}/{title}-lyrics` | Broad legacy catalog, simple parser. | High scraping risk | foobar2000 OpenLyrics, MusicBee LyricsReloaded, `rhnvrm/lyric-api-go` |
| Lyrics.com | plain | search result to `/lyric/...`, parse `pre#lyric-body-text` | Another broad plain fallback. | High scraping risk | `vookav2/songlyrics` npm aggregator |
| Lyricsify.com | LRC/plain | `https://www.lyricsify.com/search?q=...`, `/lyric/...` | Can return timestamped/LRC-like data. | High; Cloudflare/bot risk reported | OpenLyrics `lyricsify.cpp`, `moehmeni/syncedlyrics` |
| AZLyrics | plain | `https://www.azlyrics.com/lyrics/{artist}/{title}.html` | Huge plain catalog. | Very high anti-bot/ToS risk | `elmoiv/azapi`, MusicBee LyricsReloaded, beets references |
| LyricsFreak | plain | `https://www.lyricsfreak.com/search.php?q=...` | Useful old fallback. | High scraping risk | MusicBee LyricsReloaded configs |
| OldieLyrics | plain | `http://oldielyrics.com/lyrics/{artist}/{title}.html` | Older catalog niche. | High/old-site risk | MusicBee LyricsReloaded configs |
| UrbanLyrics | plain | `http://www.urbanlyrics.com/lyrics/{artist}/{title}.html` | Hip-hop/urban legacy niche. | High/availability risk | MusicBee LyricsReloaded configs |
| MakeItPersonal | plain | `https://makeitpersonal.co/lyrics?artist=...&title=...` | Extremely low implementation cost if alive. | Unknown provenance/uptime | `lyrics-fetcher` npm references |
| LyricFind web | plain | `https://lyrics.lyricfind.com/lyrics/{artist}-{title}` | Strong catalog. | Licensing-sensitive; official route preferred | OpenLyrics web parser references |

### Niche Genre / Regional Providers

| Provider | Region / Genre | Types | Value | Risk | References |
| --- | --- | --- | --- | --- | --- |
| DarkLyrics | metal | plain | Strong metal catalog, album-based pages. | High scraping risk | Rhythmbox parser, `res0nance/darklyrics`, `jakeHebert/darklyrics-rest-api` |
| Metal Archives | metal | plain/metadata | Structured AJAX for metal songs/lyrics where present; good disambiguation. | Medium-high scraping risk | MusicBee provider refs, `jasniec/MetalArchivesNET` |
| J-Lyric.net | Japanese | plain | Native Japanese lyric fallback. | High scraping risk | Rhythmbox `JlyricParser`, Japanese lyric scraper refs |
| HindiLyrics.net | Hindi/Bollywood | plain | Bollywood fallback if still reachable. | High/legacy risk | MusicBee LyricsReloaded config |
| Pesni.guru | Russian/Ukrainian | plain | Simple Cyrillic fallback. | Medium-high scraping risk | `svoemesto/Karaoke` refs |
| Text-lyrics.ru | Russian/Ukrainian | plain | Secondary Cyrillic fallback. | High scraping risk | `svoemesto/Karaoke` refs |
| sarki.alternatifim.com | Turkish | plain | Best Turkish candidate found. | Medium scraping risk | Turkish lyric scraper repos |
| sarkisozum.gen.tr | Turkish | plain | Secondary Turkish fallback. | Medium/legacy risk | Turkish lyric scraper repos |
| Ganjoor | Persian poetry/sung poems | JSON text | Clean API for public-domain/classical Persian text. | Low for poetry, not modern pop lyrics | Ganjoor public API |
| Shironet | Hebrew | plain | Strong Hebrew-native catalog. | Medium scraping/encoding risk | Hebrew scraper refs |
| SiamZone | Thai | plain | Thai native lyrics. | Medium scraping risk | Thai lyric scraper refs |
| Zing MP3 | Vietnamese | synced/plain JSON | Best Vietnamese structured candidate; may include synced lyrics. | Medium-high signing/private API risk | Zing MP3 unofficial API repos |
| lyric.tkaraoke.com | Vietnamese karaoke | plain | Vietnamese karaoke lyric fallback. | Medium scraping risk | Vietnamese karaoke scraper refs |
| lirik.kapanlagi.com | Indonesian | plain | Strong Indonesian catalog. | Medium scraping risk | Indonesian lyric scrapers |
| AfrikaLyrics | African regional | plain | Best African-regional lyric site found. | Medium scraping risk | African lyric scraper refs |
| tekstovi.net | Balkan | plain | Strong Balkan-native target. | Medium scraping risk | Balkan lyric scraper refs |
| stixoi.info | Greek | plain | Strong Greek-native catalog. | Medium scraping/encoding risk | Greek lyric scraper refs |
| karaoketexty.cz | Czech/Slovak | plain | Czech/Slovak lyric fallback. | Medium scraping risk | Karaoke/local scraper refs |
| dalszoveg.hu | Hungarian | plain | Hungarian native fallback. | Medium scraping risk | Hungarian scraper refs |
| teksty.org | Polish | plain | Polish fallback beyond Tekstowo. | Medium-high/old-site risk | Clementine, Cantata, LyricsReloaded refs |

### Synced / Karaoke / Import Sources

| Source | Types | Value | Risk | Notes |
| --- | --- | --- | --- | --- |
| MiniLyrics / ViewLyrics / Crintsoft | LRC/VLRC | Legacy synced lyric server; worth uptime probing. | Unknown server reliability, rights risk | Search/download endpoints historically under `search.crintsoft.com` and `viewlyrics.com:1212`. |
| OpenSubtitles music videos | SRT/ASS | Possible line-synced subtitles for music videos. | High matching/rights risk | Requires OpenSubtitles API key; useful only as opt-in/research. |
| UltraStar / USDB-style files | syllable/note timing | Excellent karaoke timing format. | Very high data rights risk | Implement parser/import, not hosted scraping. |
| ASS/SSA karaoke files | line/word/syllable timing | Useful parser support for local imports. | High if sourced from fansub archives | Parse `Dialogue` and `\\k`/`\\kf` tags. |
| Karaoke Mugen `.kara.json + .ass` | metadata + ASS timing | Good local library/import ecosystem. | Medium/high content rights | Better as import than remote provider. |
| UST/VSQX/VPR/USTX/SVP | note/phoneme lyric timing | Best Vocaloid/open-creator timing source. | Varies by creator license | Implement later for creator-upload/local import. |
| Bandcamp | artist-provided lyrics | Indie/long-tail lyrics from artist pages. | Medium scraping but artist-provided | Extract lyrics from track/album pages where present. |

### Practical Additions From Third Pass

Worth probing soon:

1. MiniLyrics/ViewLyrics: possible synced LRC with low integration cost if servers still work.
2. SongLyrics.com: broad plain fallback, simpler than many regional scrapers.
3. Lyrics.com: broad plain fallback via search result parsing.
4. DarkLyrics and Metal Archives: high-value metal niche.
5. J-Lyric.net: Japanese fallback if CJK providers miss.
6. Zing MP3: Vietnamese structured/synced candidate.
7. Bandcamp: artist-provided indie lyrics.
8. ASS/SRT/UltraStar/Karaoke Mugen local import parsers, not remote hosted providers.

Probably not worth default mode:

- AZLyrics, unless explicitly accepted as a high-risk scraper.
- LyricFind web scraping; use official LyricFind licensing instead.
- Broad regional scrapers until metrics show a specific language gap.
- OpenSubtitles/osu!/StepMania as remote lyric providers; better for local/import/research workflows.
