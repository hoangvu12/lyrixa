import type { LyricLine, LyricWord } from "../types";

const paragraphPattern = new RegExp("<p(?:\\s+([^>]*))?>(.*?)</p>", "gis");
const spanPattern = new RegExp("<span(?:\\s+([^>]*))?>(.*?)</span>", "gis");

export function parseTtml(ttml: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const paragraphs = ttml.split("<p").slice(1);
  for (const paragraphSource of paragraphs) {
    const close = paragraphSource.indexOf("</p>");
    if (close === -1) continue;
    const openEnd = paragraphSource.indexOf(">");
    if (openEnd === -1 || openEnd > close) continue;
    const attributes = paragraphSource.slice(0, openEnd);
    const body = paragraphSource.slice(openEnd + 1, close);
    const lineStart = parseTime(attribute(attributes, "begin"));
    const lineEnd = parseTime(attribute(attributes, "end"));
    if (lineStart === null) continue;

    const words = parseTimedSpans(body);
    const text = (words.length > 0 ? words.map((word) => word.text).join(" ") : decodeEntities(stripTags(body)))
      .replace(/\s+/g, " ")
      .trim();
    if (text) lines.push({ time: lineStart, endTime: lineEnd ?? undefined, text, words });
  }
  return addInstrumentalGaps(lines);
}

function addInstrumentalGaps(lines: LyricLine[]): LyricLine[] {
  const result: LyricLine[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const previous = result[result.length - 1];
    if (previous && typeof previous.endTime === "number" && line.time - previous.endTime >= 8) {
      result.push({ time: previous.endTime, endTime: line.time, text: "..." });
    }
    result.push(line);
  }
  return result;
}

function parseTimedSpans(body: string): LyricWord[] {
  const spans = [...body.matchAll(spanPattern)];
  const words: LyricWord[] = [];
  let pending: LyricWord | null = null;
  let previousEnd = 0;

  for (const span of spans) {
    const gap = body.slice(previousEnd, span.index ?? 0);
    const hasSeparator = stripTags(gap).trim().length > 0 || /\s/.test(gap);
    previousEnd = (span.index ?? 0) + span[0].length;

    const start = parseTime(attribute(span[1] ?? "", "begin"));
    const end = parseTime(attribute(span[1] ?? "", "end"));
    const text = decodeEntities(stripTags(span[2] ?? "").trim());
    if (start === null || end === null || !text) continue;

    if (pending && !hasSeparator) {
      pending.text += text;
      pending.endTime = end;
      continue;
    }

    pending = { time: start, endTime: end, text };
    words.push(pending);
  }

  return words;
}

function attribute(source: string, name: string): string | null {
  const match = source.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?s$/.test(value)) return Number(value.slice(0, -1));
  const parts = value.split(":");
  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (![minutes, seconds].every(Number.isFinite)) return null;
    return minutes * 60 + seconds;
  }
  if (parts.length !== 3) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&apos;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
