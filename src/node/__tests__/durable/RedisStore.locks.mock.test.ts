import { RedisStore } from "../../durable/store/RedisStore";
import * as ioredisOptional from "../../durable/optionalDeps/ioredis";
import { setupRedisStoreMock } from "./RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

describe("durable: RedisStore locks (mock)", () => {
  it("handles lock lifecycle and injected client disposal", async () => {
    const { redisMock, store } = harness;
    redisMock.set.mockResolvedValue("OK");

    const lockId = await store.acquireLock("res", 1000);
    expect(lockId).not.toBeNull();

    redisMock.eval.mockResolvedValueOnce(1 as any);
    await expect(store.renewLock("res", lockId!, 1000)).resolves.toBe(true);
    redisMock.eval.mockResolvedValueOnce(0 as any);
    await expect(store.renewLock("res", lockId!, 1000)).resolves.toBe(false);

    await store.releaseLock("res", lockId!);
    await store.dispose?.();
    expect(redisMock.quit).not.toHaveBeenCalled();

    const ownedStore = new RedisStore({
      redis: redisMock,
      disposeProvidedClient: true,
    });
    await ownedStore.dispose?.();
    expect(redisMock.quit).toHaveBeenCalledTimes(1);
  });

  it("returns null lock ids when nx acquisition fails", async () => {
    const { redisMock, store } = harness;
    redisMock.set.mockResolvedValue(null as any);
    await expect(store.acquireLock("res", 1000)).resolves.toBeNull();
  });

  it("claims timers via redis nx and renews timer claims", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(1 as any);
    await expect(
      store.renewTimerClaim("timer-1", "worker-1", 5000),
    ).resolves.toBe(true);
    redisMock.eval.mockResolvedValueOnce(0 as any);
    await expect(
      store.renewTimerClaim("timer-1", "worker-1", 5000),
    ).resolves.toBe(false);

    redisMock.set.mockResolvedValueOnce("OK");
    await expect(store.claimTimer("t1", "worker-1", 1000)).resolves.toBe(true);
    redisMock.set.mockResolvedValueOnce(null as any);
    await expect(store.claimTimer("t1", "worker-2", 1000)).resolves.toBe(false);
  });

  it("finalizes claimed timers only while the caller still owns the claim", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(1 as any);
    await expect(
      store.releaseTimerClaim?.("timer-1", "worker-1"),
    ).resolves.toBe(true);

    redisMock.eval.mockResolvedValueOnce(0 as any);
    await expect(
      store.releaseTimerClaim?.("timer-1", "worker-2"),
    ).resolves.toBe(false);

    redisMock.eval.mockResolvedValueOnce(1 as any);
    await expect(
      store.finalizeClaimedTimer?.("timer-1", "worker-1"),
    ).resolves.toBe(true);

    redisMock.eval.mockResolvedValueOnce(0 as any);
    await expect(
      store.finalizeClaimedTimer?.("timer-1", "worker-2"),
    ).resolves.toBe(false);
  });

  it("renews lock ttl only while the caller still owns the lock", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(1);
    await expect(store.renewLock("res", "lock-1", 5000)).resolves.toBe(true);
    redisMock.eval.mockResolvedValueOnce(0);
    await expect(store.renewLock("res", "lock-1", 5000)).resolves.toBe(false);
  });

  it("supports redis url strings and default constructor wiring", () => {
    const { redisMock } = harness;
    (
      ioredisOptional.createIORedisClient as unknown as jest.Mock
    ).mockReturnValue(redisMock);

    expect(new RedisStore({ redis: "redis://localhost:6379" })).toBeDefined();
    expect(new RedisStore({})).toBeDefined();
  });
});
