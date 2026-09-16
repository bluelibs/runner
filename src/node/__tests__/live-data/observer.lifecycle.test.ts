import {
  addQueue,
  createObserverHarness,
  deferred,
} from "./observer.testHelper";

describe("LiveObserver lifecycle", () => {
  it("rejects when readiness finds a disconnected provider", async () => {
    const unsubscribe = jest.fn(async () => undefined);
    const harness = createObserverHarness({
      connected: false,
      subscribe: async () => unsubscribe,
    });
    addQueue(harness.observer);

    await expect(harness.observer.ensureStarted()).rejects.toThrow(
      "disconnected before the initial snapshot",
    );
    await harness.observer.close();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("revalidates on an interval and seeds subscribers added later", async () => {
    let value = 1;
    const harness = createObserverHarness({
      revalidateEveryMs: 10,
      run: async () => value,
    });
    const first = addQueue(harness.observer);
    await harness.observer.ensureStarted();
    await expect(first.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: 1 },
    });

    const second = addQueue(harness.observer);
    await expect(second.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: 1 },
    });
    value = 2;
    await harness.intervals[0]?.();
    await expect(first.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: 2 },
    });

    harness.setConnected(false);
    harness.emit({ type: "disconnect" });
    harness.emit({ type: "disconnect" });
    const staleSubscriber = addQueue(harness.observer);
    await expect(staleSubscriber.next()).resolves.toMatchObject({
      value: { type: "stale" },
    });

    await Promise.all([first.close(), second.close(), staleSubscriber.close()]);
    harness.emit({ type: "invalidate", topics: ['["observer"]'] });
    expect(harness.intervalCancels[0]).toHaveBeenCalledTimes(1);
    await harness.observer.close();
  });

  it("shares close work and surfaces unsubscribe failures", async () => {
    const ready = deferred();
    const cleanupFailure = new Error("unsubscribe failed");
    const harness = createObserverHarness({
      subscribe: async () => {
        await ready.promise;
        return async () => {
          throw cleanupFailure;
        };
      },
    });
    addQueue(harness.observer);
    const starting = harness.observer.ensureStarted();
    const closing = harness.observer.close();
    expect(harness.observer.close()).toBe(closing);
    ready.resolve();

    await expect(starting).rejects.toThrow(
      "closed before its initial snapshot",
    );
    await expect(closing).rejects.toBe(cleanupFailure);
  });
});
