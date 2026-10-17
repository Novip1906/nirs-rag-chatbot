export function parseLimit(value: unknown, defaultLimit: number, maxLimit: number): number {
  const raw = typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (Number.isNaN(raw)) {
    return defaultLimit;
  }
  return Math.min(Math.max(raw, 1), maxLimit);
}

export function parseSkip(value: unknown): number {
  const raw = typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (Number.isNaN(raw)) {
    return 0;
  }
  return Math.max(raw, 0);
}
