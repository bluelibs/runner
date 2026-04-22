import type {
  BusEvent,
  IEventBus,
} from "../../../../durable/core/interfaces/bus";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  advanceTimers,
  flushMicrotasks,
} from "../../helpers/DurableService.unit.helpers";
import { genericError } from "../../../../../errors";

async function savePendingExecution(
  store: MemoryStore,
  executionId: string,
): Promise<void> {
  await store.saveExecution({
    id: executionId,
    workflowKey: "t",
    input: undefined,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function waitForCalls(
  getCalls: () => number,
  expectedCalls: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (getCalls() >= expectedCalls) {
      return;
    }
    await flushMicrotasks();
  }

  throw genericError.new({
    message: `Expected at least ${expectedCalls} getExecution() calls, received ${getCalls()}.`,
  });
}

describe("durable: WaitManager (poll guards)", () => {
  it("returns after an in-flight poll check when another path already settled the wait", async () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryStore();
      const bus = new MemoryEventBus();
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });
      const executionId = "e-poll-returns-after-inflight-check";
      await savePendingExecution(store, executionId);

      const originalGet = store.getExecution.bind(store);
      let releaseCheck = () => {};
      let calls = 0;
      jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
        calls += 1;
        if (calls === 4) {
          await new Promise<void>((resolve) => {
            releaseCheck = resolve;
          });
        }
        return await originalGet(id);
      });

      const waiting = manager.waitForResult<string>(executionId, {
        timeout: 1_000,
        waitPollIntervalMs: 10,
      });

      await waitForCalls(() => calls, 4);

      await store.updateExecution(executionId, {
        status: ExecutionStatus.Completed,
        result: "ok",
        completedAt: new Date(),
      });
      await bus.publish(`execution:${executionId}`, {
        type: "finished",
        payload: null,
        timestamp: new Date(),
      });
      await flushMicrotasks();

      releaseCheck();
      await flushMicrotasks();

      await expect(waiting).resolves.toBe("ok");
    } finally {
      jest.useRealTimers();
    }
  });

  it("skips polling fallback when subscribe rejects after timeout already settled the wait", async () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryStore();
      const subscriptionState: {
        rejectSubscribe: null | ((reason?: unknown) => void);
      } = {
        rejectSubscribe: null,
      };
      const bus = {
        publish: async (_channel: string, _event: BusEvent) => undefined,
        subscribe: async () => {
          await new Promise<void>((_, reject) => {
            subscriptionState.rejectSubscribe = reject;
          });
        },
        unsubscribe: async () => undefined,
      } satisfies IEventBus;
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });
      const executionId = "e-subscribe-rejects-after-timeout-guard";
      await savePendingExecution(store, executionId);

      const waiting = manager.waitForResult<string>(executionId, {
        timeout: 10,
        waitPollIntervalMs: 1_000,
      });

      await advanceTimers(10);
      await expect(waiting).rejects.toThrow("Timeout waiting for execution");

      subscriptionState.rejectSubscribe?.(
        genericError.new({ message: "subscribe-failed" }),
      );
      await flushMicrotasks();
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns from pollOnce after timeout checks when another path finishes in the same turn", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 1 });
    const executionId = "e-poll-done-after-timeout-check";
    await savePendingExecution(store, executionId);

    let releasePreflight!: (execution: {
      id: string;
      workflowKey: string;
      input: undefined;
      status: "completed";
      attempt: number;
      maxAttempts: number;
      createdAt: Date;
      updatedAt: Date;
      completedAt: Date;
      result: string;
    }) => void;
    const preflightExecution = new Promise<{
      id: string;
      workflowKey: string;
      input: undefined;
      status: "completed";
      attempt: number;
      maxAttempts: number;
      createdAt: Date;
      updatedAt: Date;
      completedAt: Date;
      result: string;
    }>((resolve) => {
      releasePreflight = resolve;
    });
    let calls = 0;
    jest.spyOn(store, "getExecution").mockImplementation(async () => {
      calls += 1;

      if (calls === 2) {
        return await preflightExecution;
      }

      if (calls === 4) {
        queueMicrotask(() => {
          releasePreflight({
            id: executionId,
            workflowKey: "t",
            input: undefined,
            status: ExecutionStatus.Completed,
            attempt: 1,
            maxAttempts: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: new Date(),
            result: "ok",
          });
        });
      }

      return {
        id: executionId,
        workflowKey: "t",
        input: undefined,
        status: ExecutionStatus.Pending,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });

    await expect(
      manager.waitForResult<string>(executionId, {
        timeout: 100,
        waitPollIntervalMs: 1,
      }),
    ).resolves.toBe("ok");
  });
});
