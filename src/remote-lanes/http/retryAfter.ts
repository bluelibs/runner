/** Parses HTTP Retry-After seconds or dates into a bounded delay. */
export function parseRetryAfterMs(
  value: string | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (!/^\d+$/.test(text) && !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(text))
    return undefined;
  const milliseconds = /^\d+$/.test(text)
    ? Number(text) * 1000
    : Date.parse(text) - nowMs;
  if (!Number.isFinite(milliseconds)) return undefined;
  return Math.min(2_147_483_647, Math.max(0, milliseconds));
}
