# Frontend Handoff: Overlapping Word Lyrics

Lyrixa now returns additive timing metadata for TTML word-level lyrics so the frontend can render overlapping vocal lines correctly without losing karaoke word timing.

## API Changes

Existing fields are unchanged. New fields are additive and backward compatible.

Top-level response may include:

```json
{
  "features": {
    "lineEndTime": true,
    "overlappingLines": true
  }
}
```

Each lyric line may now include `endTime`:

```json
{
  "time": 224.959,
  "endTime": 234.826,
  "text": "You're the chosen one",
  "words": [
    {
      "time": 226.16,
      "endTime": 226.735,
      "text": "You're"
    }
  ]
}
```

`words` is still present for word-level lyrics and should continue to drive karaoke highlighting. `line.endTime` is only for knowing whether a line is still active while another line starts.

## Why This Matters

Some Apple/LyricsPlus TTML tracks contain multiple active lyric lines at once. A single `currentLineIndex` renderer hides or flickers overlapping ad-libs/background/call-response lyrics.

Example from `Transform` by Daniel Caesar:

```text
03:44.959 - 03:54.826  You're the chosen one
03:46.965 - 03:50.157  (Can't quit you, you're like drugs)
03:50.294 - 03:53.518  (Swear I tried to clean up)
03:53.648 - 03:57.081  (Too much shared between us)
```

The long lead line should stay visible while shorter overlapping lines cycle in a secondary/stacked lane.

## Required Frontend Model

Move from one current line to active line groups.

```ts
type LyricWord = {
  time: number
  endTime: number
  text: string
}

type LyricLine = {
  time: number
  endTime?: number
  text: string
  words?: LyricWord[]
}
```

Compute active lines with `endTime` when available:

```ts
function getLineEnd(lines: LyricLine[], index: number) {
  return lines[index].endTime ?? lines[index + 1]?.time ?? Infinity
}

function getActiveLines(lines: LyricLine[], currentTime: number) {
  return lines.filter((line, index) => {
    const endTime = getLineEnd(lines, index)
    return line.time <= currentTime && currentTime < endTime
  })
}
```

Keep existing karaoke word highlighting per line:

```ts
function isWordActive(word: LyricWord, currentTime: number) {
  return word.time <= currentTime && currentTime < word.endTime
}
```

## Rendering Guidance

If `activeLines.length === 1`, render exactly like today.

If `activeLines.length > 1`, render all active lines. Do not hide any active line.

Recommended layout:

```ts
const primaryLine = choosePrimaryLine(activeLines)
const secondaryLines = activeLines.filter((line) => line !== primaryLine)
```

Primary line:

- Use the normal large/current lyric styling.
- Continue word-level karaoke highlighting from `words`.

Secondary lines:

- Render stacked above or below the primary line.
- Use smaller or slightly dimmer styling.
- Still apply word-level karaoke highlighting if `words` exists.

## Primary Selection Heuristic

Do not rely only on parentheses. Parentheses are inconsistent across songs.

Use a conservative heuristic:

```ts
function choosePrimaryLine(activeLines: LyricLine[]) {
  return activeLines
    .slice()
    .sort((a, b) => durationOf(b) - durationOf(a))[0]
}

function durationOf(line: LyricLine) {
  return typeof line.endTime === "number" ? line.endTime - line.time : 0
}
```

This handles cases where one long lead line overlaps several short ad-lib lines. If durations are similar, keep source order or render both with similar emphasis.

Optional weak tie-breaker:

```ts
function looksParenthesized(line: LyricLine) {
  const text = line.text.trim()
  return text.startsWith("(") && text.endsWith(")")
}
```

Only use parenthesized text as a tie-breaker, not as absolute background metadata.

## Important Notes

- There is no reliable `isBackground` source metadata from LyricsPlus/Apple TTML.
- `features.overlappingLines` means the backend detected overlapping line ranges.
- `features.lineEndTime` means at least some lines include `endTime`.
- Existing clients can ignore the new fields safely.
- New clients should use `line.endTime` to avoid collapsing overlapping lyrics into one current line.
