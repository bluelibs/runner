import { randomUUID } from "node:crypto";
import { RedisStore } from "../../../durable/store/RedisStore";
import {
  ExecutionStatus,
  type Execution,
  type StepResult,
} from "../../../durable/core/types";

const redisUrl =
  process.env.REAL_INFRASTRUCTURE_REDIS_URL ??
  process.env.DURABLE_TEST_REDIS_URL ??
  "redis://localhost:6379";
const shouldRun = process.env.REAL_INFRASTRUCTURE_FAULT_INTEGRATION === "1";

// Shapes Lua's cjson cannot round-trip: empty arrays and full-precision floats.
const payload = { items: [], ratio: 0.1 + 0.2, nested: { list: [[]] } };
const record = (id: string) => ({ id, payload, receivedAt: new Date(0) });

function execution(id: string, status: ExecutionStatus): Execution {
  const now = new Date();
  return {
    id,
    workflowKey: "wf",
    input: undefined,
    status,
    attempt: 1,
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function completedStep(stepId: string, result: unknown): StepResult {
  return { executionId: "e1", stepId, result, completedAt: new Date(0) };
}

(shouldRun ? describe : describe.skip)(
  "durable: RedisStore real signal payload fidelity",
  () => {
    let store: RedisStore;
    beforeEach(() => {
      store = new RedisStore({
        redis: redisUrl,
        prefix: `runner:real-signal-payloads:${randomUUID()}:`,
      });
    });
    afterEach(async () => await store.dispose());

    it("keeps queued, history and consumed payloads exact", async () => {
      await store.bufferSignalRecord("e1", "paid", record("r1"));
      await store.bufferSignalRecord("e1", "paid", record("r2"));
      await store.appendSignalRecord("e1", "paid", record("r3"));

      const state = await store.getSignalState("e1", "paid");
      expect(state?.queued).toEqual([record("r1"), record("r2")]);
      expect(state?.history[2]).toEqual(record("r3"));
      await expect(
        store.consumeQueuedSignalRecord("e1", "paid"),
      ).resolves.toEqual(record("r1"));

      const step = completedStep("__signal:paid", { state: "completed" });
      await expect(store.consumeBufferedSignalForStep(step)).resolves.toEqual(
        record("r2"),
      );
      expect(
        (await store.getStepResult("e1", "__signal:paid"))?.result,
      ).toEqual({ state: "completed", payload });
    });

    it("keeps delivered payloads exact across delivery and continuation", async () => {
      await store.saveStepResult(
        completedStep("__signal:paid", { state: "waiting", signalId: "paid" }),
      );
      await store.upsertSignalWaiter({
        executionId: "e1",
        signalId: "paid",
        stepId: "__signal:paid",
        sortKey: "a",
      });
      await store.commitSignalDelivery({
        executionId: "e1",
        signalId: "paid",
        stepId: "__signal:paid",
        stepResult: completedStep("__signal:paid", {
          state: "completed",
          payload,
        }),
        signalRecord: record("r1"),
      });
      expect(
        (await store.getStepResult("e1", "__signal:paid"))?.result,
      ).toEqual({ state: "completed", payload });

      await store.saveExecution(execution("e1", ExecutionStatus.Running));
      await store.bufferSignalRecord("e1", "paid", record("r2"));
      await store.createContinuedExecution({
        priorExecution: {
          ...execution("e1", ExecutionStatus.ContinuedAsNew),
          continuedAsExecutionId: "e2",
        },
        successorExecution: execution("e2", ExecutionStatus.Pending),
      });
      await expect(
        store.consumeQueuedSignalRecord("e2", "paid"),
      ).resolves.toEqual(record("r2"));
    });

    it("keeps a child result exact when completing an execution waiter", async () => {
      const stepId = "__execution:child";
      await store.saveStepResult(
        completedStep(stepId, { state: "waiting", targetExecutionId: "child" }),
      );
      await store.upsertExecutionWaiter({
        executionId: "e1",
        targetExecutionId: "child",
        stepId,
      });
      const result = {
        state: "completed",
        targetExecutionId: "child",
        payload,
      };
      await expect(
        store.commitExecutionWaiterCompletion({
          targetExecutionId: "child",
          executionId: "e1",
          stepId,
          stepResult: completedStep(stepId, result),
        }),
      ).resolves.toBe(true);
      expect((await store.getStepResult("e1", stepId))?.result).toEqual(result);
    });
  },
);
