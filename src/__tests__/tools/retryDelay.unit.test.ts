import { exponentialBackoffWithJitterMs } from "../../tools/retryDelay";

describe("exponentialBackoffWithJitterMs", () => {
  it("backs off exponentially from the default 100ms base", () => {
    for (const [attempt, base] of [
      [0, 100],
      [1, 200],
      [2, 400],
    ] as const) {
      const delay = exponentialBackoffWithJitterMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(base);
      expect(delay).toBeLessThan(base * 1.5);
    }
  });

  it("honors an explicit base delay", () => {
    const delay = exponentialBackoffWithJitterMs(1, 50);
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThan(150);
  });
});
