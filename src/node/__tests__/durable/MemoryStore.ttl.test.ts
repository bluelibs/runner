import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: MemoryStore TTL behavior", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("prunes expired timer claim locks while processing new claims", async () => {
    jest.useFakeTimers();
    const store = new MemoryStore();

    await store.claimTimer("t-1", "worker", 5);
    jest.advanceTimersByTime(10);
    await Promise.resolve();
    await store.claimTimer("t-2", "worker", 5);

    const internalLocks = (store as unknown as { locks: Map<string, unknown> })
      .locks;
    const claimKeys = Array.from(internalLocks.keys()).filter((key) =>
      key.startsWith("timer:claim:"),
    );

    expect(claimKeys).toEqual(["timer:claim:t-2"]);
  });

  it("renews lock TTL only when the lock owner still matches", async () => {
    jest.useFakeTimers();
    const store = new MemoryStore();

    const lockId = await store.acquireLock("resource", 20);
    expect(lockId).toBeTruthy();

    jest.advanceTimersByTime(10);
    await Promise.resolve();
    await expect(store.renewLock("resource", lockId!, 50)).resolves.toBe(true);

    jest.advanceTimersByTime(25);
    await Promise.resolve();
    await expect(store.acquireLock("resource", 5)).resolves.toBeNull();

    await expect(
      store.renewLock("resource", "another-lock-id", 50),
    ).resolves.toBe(false);

    await expect(
      store.renewLock("missing-resource", lockId!, 50),
    ).resolves.toBe(false);

    jest.advanceTimersByTime(60);
    await Promise.resolve();
    await expect(store.renewLock("resource", lockId!, 50)).resolves.toBe(false);
  });
});
