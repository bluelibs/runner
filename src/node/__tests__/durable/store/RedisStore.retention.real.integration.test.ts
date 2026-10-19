import { randomUUID } from "node:crypto";
import { RedisStore } from "../../../durable/store/RedisStore";
import type { Execution } from "../../../durable/core/types";

const enabled = process.env.REAL_INFRASTRUCTURE_FAULT_INTEGRATION === "1";
const redisUrl =
  process.env.REAL_INFRASTRUCTURE_REDIS_URL ??
  process.env.DURABLE_TEST_REDIS_URL ??
  "redis://localhost:6379";

(enabled ? describe : describe.skip)(
  "Redis successful history collection",
  () => {
    it("atomically compacts success history and preserves serializer values and idempotent results", async () => {
      const store = new RedisStore({
        redis: redisUrl,
        prefix: `runner:retention:${randomUUID()}:`,
      });
      const now = new Date();
      const execution: Execution = {
        id: "one",
        workflowKey: "workflow",
        status: "completed",
        attempt: 1,
        maxAttempts: 1,
        input: { large: "payload" },
        result: { date: now },
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        retention: { onComplete: "delete" },
      };
      try {
        await store.saveExecution(execution);
        await store.saveStepResult({
          executionId: "one",
          stepId: "effect",
          result: "receipt",
          completedAt: now,
        });
        expect(await store.collectCompletedHistory(now, 100)).toBe(1);
        expect(await store.listStepResults("one")).toEqual([]);
        const compacted = await store.getExecution("one");
        expect(compacted).toMatchObject({
          result: { date: now },
          input: undefined,
          historyCollectedAt: now,
        });
        expect(compacted!.completedAt).toEqual(now);
        expect(await store.collectCompletedHistory(now, 100)).toBe(0);
      } finally {
        await store.dispose();
      }
    });
  },
);
