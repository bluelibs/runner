import { randomUUID } from "node:crypto";
import { genericError } from "../../../../errors";
import { RedisStore } from "../../../durable/store/RedisStore";

const redisUrl =
  process.env.REAL_INFRASTRUCTURE_REDIS_URL ??
  process.env.DURABLE_TEST_REDIS_URL ??
  "redis://localhost:6379";
const shouldRun = process.env.REAL_INFRASTRUCTURE_FAULT_INTEGRATION === "1";

async function acquireLockUntil(
  store: RedisStore,
  resource: string,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const lockId = await store.acquireLock(resource, 10_000);
    if (lockId !== null) {
      return lockId;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return genericError.throw({
    message: `Redis lock "${resource}" did not become available within ${timeoutMs}ms.`,
  });
}

(shouldRun ? describe : describe.skip)("durable: RedisStore real locks", () => {
  it("keeps lock acquisition and ownership changes atomic", async () => {
    const prefix = `runner:real-locks:${randomUUID()}:`;
    const resource = "shared-work";
    const firstStore = new RedisStore({ redis: redisUrl, prefix });
    const secondStore = new RedisStore({ redis: redisUrl, prefix });

    try {
      const [firstLockId, secondLockId] = await Promise.all([
        firstStore.acquireLock(resource, 10_000),
        secondStore.acquireLock(resource, 10_000),
      ]);
      const acquiredLockIds = [firstLockId, secondLockId].filter(
        (lockId): lockId is string => lockId !== null,
      );

      expect(acquiredLockIds).toHaveLength(1);

      const owner = firstLockId === null ? secondStore : firstStore;
      const contender = firstLockId === null ? firstStore : secondStore;
      const ownerLockId = firstLockId ?? secondLockId;
      if (ownerLockId === null) {
        return genericError.throw({
          message: "Redis did not grant the lock to either contender.",
        });
      }

      const wrongOwnerId = randomUUID();
      expect(await contender.renewLock(resource, wrongOwnerId, 10_000)).toBe(
        false,
      );
      await contender.releaseLock(resource, wrongOwnerId);
      await expect(contender.acquireLock(resource, 10_000)).resolves.toBeNull();

      expect(await owner.renewLock(resource, ownerLockId, 10_000)).toBe(true);
      await owner.releaseLock(resource, ownerLockId);

      const contenderLockId = await contender.acquireLock(resource, 10_000);
      expect(contenderLockId).toEqual(expect.any(String));
      if (contenderLockId === null) {
        return genericError.throw({
          message: "Redis did not grant the lock after its owner released it.",
        });
      }
      await contender.releaseLock(resource, contenderLockId);
    } finally {
      await Promise.all([firstStore.dispose(), secondStore.dispose()]);
    }
  }, 30_000);

  it("recovers lock ownership after the live Redis lease expires", async () => {
    const prefix = `runner:real-lock-expiry:${randomUUID()}:`;
    const resource = "abandoned-work";
    const owner = new RedisStore({ redis: redisUrl, prefix });
    const recoveringWorker = new RedisStore({ redis: redisUrl, prefix });

    try {
      const abandonedLockId = await owner.acquireLock(resource, 150);
      expect(abandonedLockId).toEqual(expect.any(String));

      const recoveredLockId = await acquireLockUntil(
        recoveringWorker,
        resource,
        5_000,
      );
      expect(recoveredLockId).not.toBe(abandonedLockId);
      await recoveringWorker.releaseLock(resource, recoveredLockId);
    } finally {
      await Promise.all([owner.dispose(), recoveringWorker.dispose()]);
    }
  }, 30_000);
});
