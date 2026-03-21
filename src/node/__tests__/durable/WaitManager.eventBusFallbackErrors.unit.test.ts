import type { BusEvent, IEventBus } from "../../durable/core/interfaces/bus";
import { WaitManager } from "../../durable/core/managers/WaitManager";
import { ExecutionStatus } from "../../durable/core/types";
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

describe("durable: WaitManager (event bus fallback errors)", () => {
  it("propagates store failures from the fallback poll loop", async () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryStore();
      const bus = {
        publish: async (_channel: string, _event: BusEvent) => undefined,
        subscribe: async () => {
          throw genericError.new({ message: "subscribe-failed" });
        },
        unsubscribe: async () => undefined,
      } satisfies IEventBus;
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

      const executionId = "e-fallback-store-failure";
      await savePendingExecution(store, executionId);

      const originalGet = store.getExecution.bind(store);
      let calls = 0;
      jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
        calls += 1;
        if (calls === 3) {
          throw genericError.new({ message: "getExecution-failed" });
        }
        return await originalGet(id);
      });

      const waiting = manager.waitForResult<string>(executionId, {
        waitPollIntervalMs: 1,
      });

      for (let i = 0; i < 10 && calls < 3; i += 1) {
        await Promise.resolve();
      }
      await expect(waiting).rejects.toThrow("getExecution-failed");
    } finally {
      jest.useRealTimers();
    }
  });
});
