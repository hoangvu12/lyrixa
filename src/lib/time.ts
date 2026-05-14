export const SECOND = 1000;
export const DAY = 24 * 60 * 60 * SECOND;

export function now(): number {
  return Date.now();
}

export function ttlForType(type: string): number {
  if (type === "word") return 90 * DAY;
  if (type === "synced" || type === "instrumental") return 30 * DAY;
  if (type === "plain") return 14 * DAY;
  return DAY;
}

export function ttlForFallbackType(type: string): number {
  if (type === "synced" || type === "plain" || type === "instrumental") return 6 * 60 * 60 * SECOND;
  return ttlForType(type);
}
