import { AuthRateLimiter } from "../../exposure/authRateLimiter";

describe("AuthRateLimiter", () => {
  it("allows requests below the failure threshold", () => {
    const limiter = new AuthRateLimiter({ maxFailures: 3, windowMs: 60_000 });
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isBlocked("1.2.3.4")).toBe(false);
  });

  it("blocks requests at the failure threshold", () => {
    const limiter = new AuthRateLimiter({ maxFailures: 3, windowMs: 60_000 });
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isBlocked("1.2.3.4")).toBe(true);
  });

  it("does not block unrelated IPs", () => {
    const limiter = new AuthRateLimiter({ maxFailures: 2, windowMs: 60_000 });
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isBlocked("5.6.7.8")).toBe(false);
  });

  it("expires old failures outside the window", () => {
    const limiter = new AuthRateLimiter({ maxFailures: 2, windowMs: 100 });
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isBlocked("1.2.3.4")).toBe(true);

    // Advance time past the window
    const originalNow = Date.now;
    Date.now = () => originalNow() + 200;
    try {
      expect(limiter.isBlocked("1.2.3.4")).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it("uses default config when none is provided", () => {
    const limiter = new AuthRateLimiter();
    // Default is 10 failures — recording 9 should not block
    for (let i = 0; i < 9; i++) {
      limiter.recordFailure("10.0.0.1");
    }
    expect(limiter.isBlocked("10.0.0.1")).toBe(false);

    limiter.recordFailure("10.0.0.1");
    expect(limiter.isBlocked("10.0.0.1")).toBe(true);
  });

  it("clears all tracked state", () => {
    const limiter = new AuthRateLimiter({ maxFailures: 1, windowMs: 60_000 });
    limiter.recordFailure("1.2.3.4");
    expect(limiter.isBlocked("1.2.3.4")).toBe(true);

    limiter.clear();
    expect(limiter.isBlocked("1.2.3.4")).toBe(false);
  });

  it("evicts all IPs when the safety cap is reached", () => {
    const limiter = new AuthRateLimiter({ maxFailures: 2, windowMs: 60_000 });
    // Fill up to the safety cap (50_000)
    // We simulate this by accessing the internal failures map directly
    const internalMap = (limiter as any).failures as Map<string, number[]>;
    for (let i = 0; i < 50_000; i++) {
      internalMap.set(`ip-${i}`, [Date.now()]);
    }
    expect(internalMap.size).toBe(50_000);

    // The next recordFailure should trigger eviction
    limiter.recordFailure("new-ip");
    // After eviction + recording, only the new IP should remain
    expect(internalMap.size).toBe(1);
    expect(internalMap.has("new-ip")).toBe(true);
  });

  it("returns false for unknown IPs", () => {
    const limiter = new AuthRateLimiter();
    expect(limiter.isBlocked("never-seen")).toBe(false);
  });
});
