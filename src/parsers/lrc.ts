import type { LyricLine } from "../types";

const timePattern = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?]/g;

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timePattern)];
    if (matches.length === 0) continue;
    const text = rawLine.replace(timePattern, "").trim();
    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number((match[3] ?? "0").padEnd(3, "0")) / 1000;
      lines.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}
