import {
  addQueue,
  createObserverHarness,
  deferred,
} from "./observer.testHelper";

describe("LiveObserver refreshes", () => {
  it("coalesces delayed invalidations and cancels the pending timer", async () => {
    let value = 1;
    const harness = createObserverHarness({
      batchWindowMs: 10,
      run: async () => value,
    });
    const queue = addQueue(harness.observer);
    await harness.observer.ensureStarted();
    await queue.next();

    value = 2;
    harness.emit({ type: "invalidate", topics: ['["observer"]'] });
    harness.emit({ type: "invalidate", topics: ['["observer"]'] });
    expect(harness.timeouts).toHaveLength(1);
    await harness.timeouts[0]?.();
    await expect(queue.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: 2 },
    });

    harness.emit({ type: "invalidate", topics: ['["observer"]'] });
    await harness.observer.close();
    expect(harness.timeoutCancels[1]).toHaveBeenCalledTimes(1);
  });

  it("contains cleanup failures after a failed refresh", async () => {
    const refreshFailure = new Error("refresh failed");
    const unsubscribeFailure = new Error("unsubscribe failed");
    let reads = 0;
    const onEmpty = jest.fn();
    const harness = createObserverHarness({
      run: async () => {
        if (++reads === 1) return "initial";
        throw refreshFailure;
      },
      onEmpty,
      subscribe: async () => async () => {
        throw unsubscribeFailure;
      },
    });
    const queue = addQueue(harness.observer);
    await harness.observer.ensureStarted();
    await queue.next();

    const next = queue.next();
    harness.emit({ type: "invalidate", topics: ['["observer"]'] });
    await expect(next).rejects.toBe(refreshFailure);
    expect(onEmpty).toHaveBeenCalledTimes(1);
    await expect(harness.observer.close()).rejects.toBe(unsubscribeFailure);
  });

  it("contains retirement failures from background refreshes", async () => {
    let reads = 0;
    const harness = createObserverHarness({
      run: async () => {
        if (++reads === 1) return "initial";
        throw new Error("refresh failed");
      },
      onEmpty: () => {
        throw new Error("retirement failed");
      },
    });
    const queue = addQueue(harness.observer);
    await harness.observer.ensureStarted();
    await queue.next();
    harness.emit({ type: "invalidate", topics: ['["observer"]'] });
    await expect(queue.next()).rejects.toThrow("refresh failed");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await harness.observer.close();
  });

  it("joins a refresh started by an eager provider event", async () => {
    const readGate = deferred();
    const entered = deferred();
    const harness = createObserverHarness({
      subscribe: async (nextListener) => {
        nextListener({ type: "invalidate", topics: ['["observer"]'] });
        return async () => undefined;
      },
      run: async () => {
        entered.resolve();
        await readGate.promise;
        return "ready";
      },
    });
    const queue = addQueue(harness.observer);
    const starting = harness.observer.ensureStarted();
    await entered.promise;
    readGate.resolve();
    await starting;
    await expect(queue.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: "ready" },
    });
    await harness.observer.close();
  });

  it("discards a read that completes while disconnected", async () => {
    const gate = deferred();
    const entered = deferred();
    const harness = createObserverHarness({
      run: async () => {
        entered.resolve();
        await gate.promise;
        return "stale";
      },
    });
    addQueue(harness.observer);
    const starting = harness.observer.ensureStarted();
    await entered.promise;
    harness.setConnected(false);
    harness.emit({ type: "disconnect" });
    gate.resolve();

    await expect(starting).rejects.toThrow(
      "disconnected before the initial snapshot completed",
    );
    await harness.observer.close();
  });

  it("finishes a resync requested during a closing refresh", async () => {
    const refresh = deferred();
    let reads = 0;
    const harness = createObserverHarness({
      run: async (signal) => {
        if (++reads === 1) return "initial";
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
        return refresh.promise;
      },
    });
    const queue = addQueue(harness.observer);
    await harness.observer.ensureStarted();
    await queue.next();
    harness.emit({ type: "invalidate", topics: ['["observer"]'] });
    harness.emit({ type: "resync" });

    await harness.observer.close();
    expect(reads).toBe(2);
  });
});
