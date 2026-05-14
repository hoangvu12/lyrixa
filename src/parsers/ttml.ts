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
    if (lineStart === null) continue;

    const words: LyricWord[] = [];
    const spans = body.split("<span").slice(1);
    for (const spanSource of spans) {
      const spanClose = spanSource.indexOf("</span>");
      const spanOpenEnd = spanSource.indexOf(">");
      if (spanClose === -1 || spanOpenEnd === -1 || spanOpenEnd > spanClose) continue;
      const spanAttributes = spanSource.slice(0, spanOpenEnd);
      const spanBody = spanSource.slice(spanOpenEnd + 1, spanClose);
      const start = parseTime(attribute(spanAttributes, "begin"));
      const end = parseTime(attribute(spanAttributes, "end"));
      const text = stripTags(spanBody).trim();
      if (start === null || end === null || !text) continue;
      words.push({ time: start, endTime: end, text: decodeEntities(text) });
    }

    const text = words.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
    if (text) lines.push({ time: lineStart, text, words });
  }
  return lines;
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
