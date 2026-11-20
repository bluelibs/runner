import { randomUUID } from "node:crypto";
import {
  RedisStore,
  type RedisClient,
} from "../../../durable/store/RedisStore";
import { createIORedisClient } from "../../../durable/optionalDeps/ioredis";
import type { DurableCommandRecord } from "../../../durable/core/interfaces/commands";
import { pendingExecution } from "../helpers/DurableService.unit.helpers";

interface WatchClient extends RedisClient {
  watch(...keys: string[]): Promise<unknown>;
  multi(): { set(key: string, value: string): { exec(): Promise<unknown> } };
}
const enabled = process.env.REAL_INFRASTRUCTURE_FAULT_INTEGRATION === "1";
const redisUrl =
  process.env.REAL_INFRASTRUCTURE_REDIS_URL ?? "redis://localhost:6379";
const executionId = "exact/id:a";
const request = (id: string): DurableCommandRecord => ({
  id,
  executionId,
  requestedExecutionId: executionId,
  taskKey: "change",
  input: undefined,
  status: "pending",
  createdAt: new Date(0),
});

(enabled ? describe : describe.skip)(
  "Redis command wakeups and unchanged history",
  () => {
    const prefix = `runner:command-timers:${randomUUID()}:`;
    let store: RedisStore;
    let other: RedisStore;
    let observer: WatchClient;
    beforeEach(() => {
      store = new RedisStore({ redis: redisUrl, prefix });
      other = new RedisStore({ redis: redisUrl, prefix });
      observer = createIORedisClient(redisUrl) as WatchClient;
    });
    afterEach(async () => {
      await observer.eval(
        'local keys = redis.call("keys", ARGV[1]); if #keys > 0 then return redis.call("del", unpack(keys)) end; return 0',
        0,
        `${prefix}*`,
      );
      await Promise.all([store.dispose(), other.dispose(), observer.quit()]);
    });

    it("admits one shared wakeup atomically across independent clients", async () => {
      await store.saveExecution(pendingExecution({ id: executionId }));
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          (index % 2 ? store : other).enqueueCommand(request("one")),
        ),
      );
      const timers = await other.getExecutionTimers(executionId);
      expect(timers).toHaveLength(1);
      expect(timers[0]).toMatchObject({ type: "retry", commandWakeup: true });
      await other.enqueueCommand(request("two"));
      expect(await store.getExecutionTimers(executionId)).toEqual(timers);
      expect(
        await other.rescheduleCommandTimer(
          executionId,
          new Date(Date.now() + 60000),
        ),
      ).toBe(true);
      expect(await store.getReadyTimers(new Date())).toEqual([]);
      expect(
        await store.completeCommand({ ...request("one"), status: "failed" }),
      ).toBe(true);
      expect(await other.getExecutionTimers(executionId)).toHaveLength(1);
      expect(
        await other.completeCommand({ ...request("two"), status: "failed" }),
      ).toBe(true);
      expect(await store.getExecutionTimers(executionId)).toEqual([]);
      expect(await store.rescheduleCommandTimer(executionId, new Date())).toBe(
        false,
      );
    });

    it("does not let an older delivery erase the next admission or its indexes", async () => {
      await store.saveExecution(pendingExecution({ id: executionId }));
      await store.enqueueCommand(request("one"));
      const [timer] = await other.getExecutionTimers(executionId);
      expect(await store.claimTimer(timer.id, "old", 30000)).toBe(true);
      await store.rescheduleCommandTimer(
        executionId,
        new Date(Date.now() + 1000),
      );
      await store.completeCommand({ ...request("one"), status: "failed" });
      await other.enqueueCommand(request("two"));
      expect(await store.releaseTimerClaim(timer.id, "old")).toBe(true);
      expect(await other.getExecutionTimers(executionId)).toEqual([
        expect.objectContaining({ id: timer.id }),
      ]);
      expect(
        await other.claimReadyTimers(
          new Date(Date.now() + 2000),
          10,
          "new",
          30000,
        ),
      ).toEqual([expect.objectContaining({ id: timer.id })]);
      await other.releaseTimerClaim(timer.id, "new");
    });

    it("does not write watched history or sequence keys for repeated phases", async () => {
      const operation = { kind: "state" as const, stepId: "change" };
      const historyKey = `${prefix}history:${encodeURIComponent(executionId)}`;
      const sequenceKey = `${prefix}history_sequence:${encodeURIComponent(executionId)}`;
      const unchanged = async (phase: "started" | "completed") => {
        await observer.watch(historyKey, sequenceKey);
        await other.recordExecutionHistory(executionId, {
          ...operation,
          phase,
          stateAfter: null,
        });
        expect(
          await observer.multi().set(`${prefix}probe`, "ok").exec(),
        ).not.toBeNull();
      };
      await store.recordExecutionHistory(executionId, {
        ...operation,
        phase: "started",
      });
      await unchanged("started");
      await store.recordExecutionHistory(executionId, {
        ...operation,
        phase: "completed",
        stateAfter: { value: 7n },
      });
      await unchanged("started");
      await unchanged("completed");
      expect(await store.listExecutionHistory(executionId)).toEqual([
        {
          ...operation,
          startedOrder: 1,
          completedOrder: 2,
          stateAfter: { value: 7n },
        },
      ]);
    });
  },
);
