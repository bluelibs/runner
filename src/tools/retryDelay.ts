/**
 * Exponential backoff with jitter for retry delays.
 *
 * Shared by task retry middleware and remote-lane retry policies so both
 * systems back off identically by default.
 *
 * @param attempt Zero-based retry index (0 for the first retry delay).
 * @param baseMs Base delay in milliseconds before exponential growth.
 * @returns Delay in milliseconds between `baseMs * 2^attempt` and 1.5x that.
 */
export function exponentialBackoffWithJitterMs(
  attempt: number,
  baseMs = 100,
): number {
  const backoffMs = baseMs * Math.pow(2, attempt);
  const jitterMs = Math.floor(Math.random() * Math.max(1, backoffMs / 2));
  return backoffMs + jitterMs;
}
