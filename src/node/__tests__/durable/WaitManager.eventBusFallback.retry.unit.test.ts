import type { BusEvent, IEventBus } from "../../durable/core/interfaces/bus";
import { WaitManager } from "../../durable/core/managers/WaitManager";
import { ExecutionStatus } from "../../durable/core/types";
import * as utils from "../../durable/core/utils";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { genericError } from "../../../errors";

async function savePendingExecution(
  store: MemoryStore,
  executionId: string,
): Promise<void> {
  await store.saveExecution({
    id: executionId,
    taskId: "t",
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
  it("sleeps between fallback polling attempts after subscribe() fails", async () => {
    const sleepSpy = jest.spyOn(utils, "sleepMs").mockResolvedValue(undefined);
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

    try {
      await expect(
        manager.waitForResult<string>(executionId, {
          waitPollIntervalMs: 5,
        }),
      ).resolves.toBe("ok");
      expect(sleepSpy).toHaveBeenCalledWith(5);
    } finally {
      sleepSpy.mockRestore();
    }
  });

  it("still times out when subscribe() fails and fallback polling keeps seeing a pending execution", async () => {
    const sleepSpy = jest.spyOn(utils, "sleepMs").mockResolvedValue(undefined);
    const nowSpy = jest.spyOn(Date, "now");
    const store = new MemoryStore();
    const manager = new WaitManager(store, failingSubscribeBus(), {
      defaultPollIntervalMs: 5,
    });

    const executionId = "e-fallback-timeout";
    await savePendingExecution(store, executionId);

    let nowMs = 1_000;
    nowSpy.mockImplementation(() => nowMs);
    sleepSpy.mockImplementation(async (ms) => {
      nowMs += ms;
    });

    try {
      await expect(
        manager.waitForResult<string>(executionId, {
          timeout: 10,
          waitPollIntervalMs: 5,
        }),
      ).rejects.toThrow("Timeout waiting for execution");

      expect(sleepSpy).toHaveBeenCalledWith(5);
    } finally {
      sleepSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });
});
