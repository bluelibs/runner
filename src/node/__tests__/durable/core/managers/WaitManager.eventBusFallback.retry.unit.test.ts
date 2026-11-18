import type {
  BusEvent,
  IEventBus,
} from "../../../../durable/core/interfaces/bus";
import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import { ExecutionStatus } from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { genericError } from "../../../../../errors";
import { fakeNodeTimers } from "../../helpers/DurableService.unit.helpers";

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

function failingSubscribeBus(): IEventBus {
  return {
    publish: async (_channel: string, _event: BusEvent) => undefined,
    subscribe: async () => {
      throw genericError.new({ message: "subscribe-failed" });
    },
    unsubscribe: async () => undefined,
  };
}

describe("durable: WaitManager (event bus fallback retry)", () => {
  it("honors the polling interval after subscribe() fails", async () => {
    const store = new MemoryStore();
    const manager = new WaitManager(store, failingSubscribeBus(), {
      defaultPollIntervalMs: 5,
    });

    const executionId = "e-fallback-sleeps";
    await savePendingExecution(store, executionId);

    const originalGet = store.getExecution.bind(store);
    let calls = 0;
    jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
      calls += 1;
      if (calls >= 4) {
        await store.updateExecution(executionId, {
          status: ExecutionStatus.Completed,
          result: "ok",
          completedAt: new Date(),
        });
      }
      return await originalGet(id);
    });

    const restoreTimers = fakeNodeTimers();
    try {
      const done = manager.waitForResult<string>(executionId, {
        waitPollIntervalMs: 5,
      });
      await jest.advanceTimersByTimeAsync(4);
      expect(calls).toBe(2);
      await jest.advanceTimersByTimeAsync(1);
      const callsAfterOnePoll = calls;
      expect(callsAfterOnePoll).toBeGreaterThan(2);
      await jest.advanceTimersByTimeAsync(4);
      expect(calls).toBe(callsAfterOnePoll);
      await jest.advanceTimersByTimeAsync(1);
      expect(await done).toBe("ok");
    } finally {
      restoreTimers();
    }
  });

  it("still times out when subscribe() fails and fallback polling keeps seeing a pending execution", async () => {
    const store = new MemoryStore();
    const manager = new WaitManager(store, failingSubscribeBus(), {
      defaultPollIntervalMs: 5,
    });

    const executionId = "e-fallback-timeout";
    await savePendingExecution(store, executionId);

    const restoreTimers = fakeNodeTimers();
    try {
      const outcome = manager
        .waitForResult<string>(executionId, {
          timeout: 10,
          waitPollIntervalMs: 5,
        })
        .catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(10);
      expect(await outcome).toMatchObject({
        message: `Timeout waiting for execution ${executionId}`,
      });
    } finally {
      restoreTimers();
    }
  });
});
