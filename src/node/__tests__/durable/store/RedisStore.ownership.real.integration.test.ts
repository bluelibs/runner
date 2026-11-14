import { randomUUID } from "node:crypto";
import {
  RedisStore,
  type RedisClient,
} from "../../../durable/store/RedisStore";
import { createIORedisClient } from "../../../durable/optionalDeps/ioredis";
import {
  okTask,
  pendingExecution,
} from "../helpers/DurableService.unit.helpers";
import { DurableService } from "../../../durable/core/DurableService";
import type { IDurableContext } from "../../../durable/core/interfaces/context";
import { waitUntil } from "../../../durable/test-utils";

const enabled = process.env.REAL_INFRASTRUCTURE_FAULT_INTEGRATION === "1";
const redisUrl =
  process.env.REAL_INFRASTRUCTURE_REDIS_URL ??
  process.env.DURABLE_TEST_REDIS_URL ??
  "redis://localhost:6379";

(enabled ? describe : describe.skip)("Redis atomic execution ownership", () => {
  it("recovers a live cluster after lease expiry without restarting the replacement worker", async () => {
    const prefix = `runner:takeover:${randomUUID()}:`;
    const first = new RedisStore({ redis: redisUrl, prefix });
    const second = new RedisStore({ redis: redisUrl, prefix });
    const client = createIORedisClient(redisUrl) as RedisClient;
    const task = okTask("redis-takeover");
    let release!: () => void;
    let entered = false;
    let checkpoints = 0;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    function worker(store: RedisStore, name: string) {
      let context!: IDurableContext;
      return new DurableService({
        store,
        tasks: [task],
        polling: { enabled: false },
        recovery: { enabled: name === "replacement", intervalMs: 20 },
        contextProvider: async (ctx, fn) => {
          context = ctx;
          return fn();
        },
        taskExecutor: {
          run: async (): Promise<any> => {
            await context.step("prepare", async () => {
              checkpoints++;
              return true;
            });
            return context.step("effect", async () => {
              if (name === "original") {
                entered = true;
                await blocked;
              }
              return name;
            });
          },
        },
      });
    }
    const original = worker(first, "original");
    const replacement = worker(second, "replacement");
    let running: Promise<void> | undefined;
    try {
      await first.saveExecution(
        pendingExecution({ id: "one", workflowKey: task.id }),
      );
      running = original.processExecution("one");
      await waitUntil(() => entered, { timeoutMs: 5_000, intervalMs: 5 });
      replacement.startHistoryCollection();
      await client.eval(
        'return redis.call("pexpire", KEYS[1], 0)',
        1,
        `${prefix}lock:execution:one`,
      );
      await waitUntil(
        async () => (await second.getExecution("one"))?.status === "completed",
        { timeoutMs: 5_000, intervalMs: 10 },
      );
      release();
      await running;
      expect((await second.getExecution("one"))?.result).toBe("replacement");
      expect((await second.getStepResult("one", "effect"))?.result).toBe(
        "replacement",
      );
      expect(checkpoints).toBe(1);
    } finally {
      release();
      await running;
      await Promise.all([original.stop(), replacement.stop()]);
      const keys = await client.keys!(`${prefix}*`);
      if (Array.isArray(keys) && keys.length)
        await client.eval(
          'return redis.call("del", unpack(KEYS))',
          keys.length,
          ...keys,
        );
      await Promise.all([first.dispose(), second.dispose(), client.quit()]);
    }
  });

  it("fences stale progress and timer/waiter commits across independent clients", async () => {
    const prefix = `runner:ownership:${randomUUID()}:`;
    const a = new RedisStore({ redis: redisUrl, prefix });
    const b = new RedisStore({ redis: redisUrl, prefix });
    const client = createIORedisClient(redisUrl) as RedisClient;
    const now = new Date();
    const onLost = (): never => {
      throw new Error("lease lost");
    };
    try {
      await a.saveExecution(pendingExecution({ id: "one" }));
      const first = (await a.acquireLock("execution:one", 30_000))!;
      const old = a.withExecutionOwnership({
        executionId: "one",
        lockId: first,
        onLost,
      });
      await old.saveStepResult({
        executionId: "one",
        stepId: "checkpoint",
        result: { date: now },
        completedAt: now,
      });
      await old.saveWorkflowState!({
        executionId: "one",
        state: "before",
        updatedAt: now,
      });
      await old.createTimer({
        id: "timer",
        executionId: "one",
        stepId: "sleep",
        type: "sleep",
        status: "pending",
        fireAt: now,
      });
      await old.upsertSignalWaiter({
        executionId: "one",
        signalId: "paid",
        stepId: "wait",
        sortKey: "wait",
      });
      expect(await b.hasExecutionLease("one")).toBe(true);
      await a.releaseLock("execution:one", first);
      const next = (await b.acquireLock("execution:one", 30_000))!;
      // Temporary locks have their own owner tokens; a stale execution may clean up its own.
      const cleanup = (await old.acquireLock!("temporary", 30_000))!;
      expect(await old.renewLock!("temporary", cleanup, 30_000)).toBe(true);
      await old.releaseLock!("temporary", cleanup);
      await old.releaseLock!("execution:one", first);
      expect(await b.hasExecutionLease("one")).toBe(true);
      const winner = b.withExecutionOwnership({
        executionId: "one",
        lockId: next,
        onLost,
      });
      await winner.updateExecution("one", {
        result: "winner",
        status: "completed",
      });
      await winner.saveWorkflowState!({
        executionId: "one",
        state: "winner",
        updatedAt: now,
      });
      await expect(
        old.saveStepResult({
          executionId: "one",
          stepId: "checkpoint",
          result: "stale",
          completedAt: now,
        }),
      ).rejects.toThrow("lease lost");
      await expect(
        old.saveWorkflowState!({
          executionId: "one",
          state: "stale",
          updatedAt: now,
        }),
      ).rejects.toThrow("lease lost");
      await expect(
        old.updateExecution("one", { result: "stale" }),
      ).rejects.toThrow("lease lost");
      await expect(old.deleteTimer("timer")).rejects.toThrow("lease lost");
      await expect(
        old.deleteSignalWaiter("one", "paid", "wait"),
      ).rejects.toThrow("lease lost");
      expect((await b.getExecution("one"))?.result).toBe("winner");
      expect((await b.getStepResult("one", "checkpoint"))?.result).toEqual({
        date: now,
      });
      expect((await b.getWorkflowState("one"))?.state).toBe("winner");
      expect(await b.getExecutionTimers("one")).toHaveLength(1);
      // Force backend expiry without waiting for the normal 30 second attempt TTL.
      await client.eval(
        'return redis.call("pexpire", KEYS[1], 0)',
        1,
        `${prefix}lock:execution:one`,
      );
      expect(await b.hasExecutionLease("one")).toBe(false);
      await expect(winner.deleteTimer("timer")).rejects.toThrow("lease lost");
    } finally {
      const keys = await client.keys!(`${prefix}*`);
      if (Array.isArray(keys) && keys.length)
        await client.eval(
          'return redis.call("del", unpack(KEYS))',
          keys.length,
          ...keys,
        );
      await Promise.all([a.dispose(), b.dispose(), client.quit()]);
    }
  });
});
