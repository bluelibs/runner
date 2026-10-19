import { randomUUID } from "node:crypto";
import {
  RedisStore,
  type RedisClient,
} from "../../../durable/store/RedisStore";
import { createIORedisClient } from "../../../durable/optionalDeps/ioredis";
import type { Execution } from "../../../durable/core/types";

const enabled = process.env.REAL_INFRASTRUCTURE_FAULT_INTEGRATION === "1";
const redisUrl =
  process.env.REAL_INFRASTRUCTURE_REDIS_URL ??
  process.env.DURABLE_TEST_REDIS_URL ??
  "redis://localhost:6379";

function completed(
  id: string,
  now: Date,
  extra: Partial<Execution> = {},
): Execution {
  return {
    id,
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
    ...extra,
  };
}

(enabled ? describe : describe.skip)(
  "Redis successful history collection",
  () => {
    it("atomically compacts success history and preserves serializer values and idempotent results", async () => {
      const store = new RedisStore({
        redis: redisUrl,
        prefix: `runner:retention:${randomUUID()}:`,
      });
      const now = new Date();
      const execution = completed("one", now);
      try {
        await store.createExecutionWithIdempotencyKey({
          execution,
          workflowKey: execution.workflowKey,
          idempotencyKey: "external-retry",
        });
        await store.saveStepResult({
          executionId: "one",
          stepId: "effect",
          result: "receipt",
          completedAt: now,
        });
        await store.createTimer({
          id: "owned",
          executionId: "one",
          type: "sleep",
          status: "pending",
          fireAt: now,
        });
        await store.createTimer({
          id: "scheduled",
          scheduleId: "recurring",
          type: "scheduled",
          status: "pending",
          fireAt: now,
        });
        expect(await store.collectCompletedHistory(now, 100)).toBe(1);
        expect(
          (await store.getReadyTimers(now)).map((timer) => timer.id),
        ).toEqual(["scheduled"]);
        expect(await store.listStepResults("one")).toEqual([]);
        const compacted = await store.getExecution("one");
        expect(compacted).toMatchObject({
          result: { date: now },
          input: undefined,
          historyCollectedAt: now,
        });
        expect(compacted!.completedAt).toEqual(now);
        expect(
          await store.createExecutionWithIdempotencyKey({
            execution: completed("duplicate", now),
            workflowKey: execution.workflowKey,
            idempotencyKey: "external-retry",
          }),
        ).toEqual({ created: false, executionId: "one" });
        expect(await store.getExecution("duplicate")).toBeNull();
        expect(await store.collectCompletedHistory(now, 100)).toBe(0);
      } finally {
        await store.dispose();
      }
    });

    it("protects parents, waiters, and locks without starving later due history", async () => {
      const store = new RedisStore({
        redis: redisUrl,
        prefix: `runner:retention:${randomUUID()}:`,
      });
      const now = new Date();
      const protectedIds = ["a-child", "b-locked", "c-waited"];
      try {
        await store.saveExecution(
          completed("parent", now, {
            status: "running",
            retention: undefined,
          }),
        );
        await store.saveExecution(
          completed("a-child", now, {
            parentExecutionId: "parent",
          }),
        );
        await store.saveExecution(completed("b-locked", now));
        await store.saveExecution(completed("c-waited", now));
        await store.saveExecution(completed("z-eligible", now));
        for (const id of [...protectedIds, "z-eligible"]) {
          await store.saveStepResult({
            executionId: id,
            stepId: "effect",
            result: id,
            completedAt: now,
          });
        }
        const lock = await store.acquireLock("execution:b-locked", 30_000);
        expect(lock).not.toBeNull();
        await store.upsertExecutionWaiter({
          targetExecutionId: "c-waited",
          executionId: "parent",
          stepId: "wait",
        });
        const results: number[] = [];
        for (let index = 0; index < 4; index++) {
          results.push(await store.collectCompletedHistory(now, 1));
        }
        expect(results).toEqual([0, 0, 0, 1]);
        for (const id of protectedIds) {
          expect(await store.listStepResults(id)).toHaveLength(1);
        }
        expect(await store.listStepResults("z-eligible")).toEqual([]);

        await store.saveExecution(
          completed("parent", now, { retention: undefined }),
        );
        await store.releaseLock("execution:b-locked", lock!);
        await store.deleteExecutionWaiter("c-waited", "parent", "wait");
        expect(
          await store.collectCompletedHistory(
            new Date(now.getTime() + 60_001),
            3,
          ),
        ).toBe(3);
        for (const id of protectedIds) {
          expect(await store.listStepResults(id)).toEqual([]);
        }
      } finally {
        await store.dispose();
      }
    });

    it("preserves history when an operator changes the execution before the Lua commit", async () => {
      const prefix = `runner:retention:${randomUUID()}:`;
      const redis = createIORedisClient(redisUrl) as RedisClient;
      const store = new RedisStore({
        redis,
        prefix,
        disposeProvidedClient: true,
      });
      const operator = new RedisStore({ redis: redisUrl, prefix });
      const now = new Date();
      const evaluate = redis.eval.bind(redis);
      try {
        await store.saveExecution(completed("one", now));
        await store.saveStepResult({
          executionId: "one",
          stepId: "effect",
          result: "keep",
          completedAt: now,
        });
        jest.spyOn(redis, "eval").mockImplementationOnce(async (...args) => {
          await operator.forceFail("one", { message: "operator action" });
          return evaluate(...args);
        });
        expect(await store.collectCompletedHistory(now, 1)).toBe(0);
        expect(await store.getExecution("one")).toMatchObject({
          status: "failed",
          input: { large: "payload" },
        });
        expect(await store.listStepResults("one")).toHaveLength(1);
        expect(
          await store.collectCompletedHistory(
            new Date(now.getTime() + 60_001),
            1,
          ),
        ).toBe(0);
      } finally {
        await Promise.all([store.dispose(), operator.dispose()]);
      }
    });

    it.each<Execution["retention"]>([
      { onComplete: "retain" },
      { onComplete: { afterMs: 60_000 } },
    ])(
      "honors retention changed after due selection: %j",
      async (retention) => {
        const prefix = `runner:retention:${randomUUID()}:`;
        const redis = createIORedisClient(redisUrl) as RedisClient;
        const store = new RedisStore({
          redis,
          prefix,
          disposeProvidedClient: true,
        });
        const operator = new RedisStore({ redis: redisUrl, prefix });
        const now = new Date();
        const selectDue = redis.zrangebyscore.bind(redis);
        try {
          await store.saveExecution(completed("one", now));
          await store.saveStepResult({
            executionId: "one",
            stepId: "effect",
            result: "keep",
            completedAt: now,
          });
          jest
            .spyOn(redis, "zrangebyscore")
            .mockImplementationOnce(async (...args) => {
              const due = await selectDue(...args);
              await operator.saveExecution(
                completed("one", now, { retention }),
              );
              return due;
            });
          expect(await store.collectCompletedHistory(now, 1)).toBe(0);
          expect(await store.listStepResults("one")).toHaveLength(1);
          expect(
            (await store.getExecution("one"))!.historyCollectedAt,
          ).toBeUndefined();
          const later = new Date(now.getTime() + 60_001);
          expect(await store.collectCompletedHistory(later, 1)).toBe(
            retention!.onComplete === "retain" ? 0 : 1,
          );
        } finally {
          await Promise.all([store.dispose(), operator.dispose()]);
        }
      },
    );
  },
);
