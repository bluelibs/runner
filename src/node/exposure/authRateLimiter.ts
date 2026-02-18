/**
 * In-memory sliding-window rate limiter for authentication failures.
 *
 * Prevents brute-force credential guessing by returning 429 Too Many Requests
 * after a configurable number of auth failures within a sliding window.
 */

export interface AuthRateLimitConfig {
  /** Maximum auth failures allowed per IP within the window (default: 10). */
  maxFailures?: number;
  /** Window size in milliseconds (default: 60 000 — one minute). */
  windowMs?: number;
}

const DEFAULT_MAX_FAILURES = 10;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Safety cap to prevent the timestamps map from growing unboundedly
 * under heavy traffic from many distinct IPs.
 */
const MAX_TRACKED_IPS = 50_000;

export class AuthRateLimiter {
  private readonly maxFailures: number;
  private readonly windowMs: number;
  /** IP → sorted array of failure timestamps (ms). */
  private readonly failures = new Map<string, number[]>();

  constructor(config?: AuthRateLimitConfig) {
    this.maxFailures = config?.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
  }

  /** Record a failed auth attempt for the given IP. */
  recordFailure(ip: string): void {
    // Evict all tracked IPs when safety cap is reached to prevent memory leak.
    if (this.failures.size >= MAX_TRACKED_IPS) {
      this.failures.clear();
    }

    let timestamps = this.failures.get(ip);
    if (!timestamps) {
      timestamps = [];
      this.failures.set(ip, timestamps);
    }
    timestamps.push(Date.now());
  }

  /** Returns `true` when the IP has exceeded the allowed failure rate. */
  isBlocked(ip: string): boolean {
    const timestamps = this.failures.get(ip);
    if (!timestamps) return false;

    const cutoff = Date.now() - this.windowMs;
    // Trim expired entries
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
    if (timestamps.length === 0) {
      this.failures.delete(ip);
      return false;
    }

    return timestamps.length >= this.maxFailures;
  }

  /** Release all tracked state. */
  clear(): void {
    this.failures.clear();
  }
}
