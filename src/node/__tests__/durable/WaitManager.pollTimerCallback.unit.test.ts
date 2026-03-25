import * as timers from "node:timers";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { WaitManager } from "../../durable/core/managers/WaitManager";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  flushMicrotasks,
  requireScheduledCallback,
} from "./DurableService.unit.helpers";

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

describe("durable: WaitManager (poll timer callback)", () => {
  it("returns from a queued poll callback when the wait already finished", async () => {
    let scheduledPollCallback: null | (() => void) = null;
    const mockSetTimeout = ((callback: unknown) => {
      if (typeof callback === "function") {
        scheduledPollCallback = callback as () => void;
      }
      return {
        unref: jest.fn(),
      };
    }) as unknown as typeof timers.setTimeout;
    mockSetTimeout.__promisify__ = timers.setTimeout.__promisify__;
    const clearTimeoutSpy = jest
      .spyOn(timers, "clearTimeout")
      .mockImplementation(() => undefined);
    const setTimeoutSpy = jest
      .spyOn(timers, "setTimeout")
      .mockImplementation(mockSetTimeout);
    try {
      const store = new MemoryStore();
      const bus = new MemoryEventBus();
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });
      const executionId = "e-queued-poll-callback-after-finish";
      await savePendingExecution(store, executionId);

      const originalGet = store.getExecution.bind(store);
      let calls = 0;
      jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
        calls += 1;
        return await originalGet(id);
      });

      const waiting = manager.waitForResult<string>(executionId, {
        waitPollIntervalMs: 10,
      });

      for (let i = 0; i < 20 && (!scheduledPollCallback || calls < 4); i += 1) {
        await flushMicrotasks();
      }
      const queuedPollCallback = requireScheduledCallback(
        scheduledPollCallback,
        "Expected WaitManager to schedule a follow-up poll",
      );
      expect(calls).toBeGreaterThanOrEqual(4);

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

      const callsBeforeQueuedCallback = calls;
      queuedPollCallback();
      await flushMicrotasks();

      expect(calls).toBe(callsBeforeQueuedCallback);
      await expect(waiting).resolves.toBe("ok");
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });
});
