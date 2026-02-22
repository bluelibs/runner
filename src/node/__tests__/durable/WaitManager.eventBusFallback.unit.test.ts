import type { BusEvent, IEventBus } from "../../durable/core/interfaces/bus";
import { WaitManager } from "../../durable/core/managers/WaitManager";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createMessageError } from "../../../errors";

class SilentEventBus implements IEventBus {
  async publish(_channel: string, _event: BusEvent): Promise<void> {}
  async subscribe(
    _channel: string,
    _handler: (event: BusEvent) => Promise<void>,
  ): Promise<void> {}
  async unsubscribe(_channel: string): Promise<void> {}
}

describe("durable: WaitManager (event bus fallback)", () => {
  it("falls back to polling even when the event bus never delivers events", async () => {
    const store = new MemoryStore();
    const bus = new SilentEventBus();
    const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

    const executionId = "e1";
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

    const waiting = manager.waitForResult<string>(executionId, {
      timeout: 1_000,
      waitPollIntervalMs: 5,
    });

    setTimeout(() => {
      void store.updateExecution(executionId, {
        status: ExecutionStatus.Completed,
        result: "ok",
        completedAt: new Date(),
      });
    }, 10).unref?.();

    await expect(waiting).resolves.toBe("ok");
  });

  it("stops polling when the timeout finalizes the wait", async () => {
    const store = new MemoryStore();
    const bus = new SilentEventBus();
    const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

    const executionId = "e-timeout";
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

    const originalGet = store.getExecution.bind(store);
    let calls = 0;
    let unblock: (() => void) | null = null;
    const block = new Promise<void>((resolve) => {
      unblock = resolve;
    });

    jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
      calls += 1;
      if (calls === 4) {
        await block;
        return await originalGet(id);
      }
      return await originalGet(id);
    });

    setTimeout(() => {
      unblock?.();
    }, 25).unref?.();

    await expect(
      manager.waitForResult<string>(executionId, {
        timeout: 10,
        waitPollIntervalMs: 1_000,
      }),
    ).rejects.toThrow("Timeout waiting for execution");
  });

  it("propagates store failures while building the timeout error", async () => {
    const store = new MemoryStore();
    const bus = new SilentEventBus();
    const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

    const executionId = "e-timeout-error";
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

    const originalGet = store.getExecution.bind(store);
    let calls = 0;
    jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
      calls += 1;
      if (calls === 4) {
        throw createMessageError("getExecution-failed");
      }
      return await originalGet(id);
    });

    await expect(
      manager.waitForResult<string>(executionId, {
        timeout: 10,
        waitPollIntervalMs: 1_000,
      }),
    ).rejects.toThrow("getExecution-failed");
  });

  it("uses unknown taskId/attempt when execution is missing during timeout", async () => {
    const store = new MemoryStore();
    const bus = new SilentEventBus();
    const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

    const executionId = "e-timeout-missing";
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

    const originalGet = store.getExecution.bind(store);
    let calls = 0;
    jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
      calls += 1;
      if (calls === 4) {
        return null;
      }
      return await originalGet(id);
    });

    await expect(
      manager.waitForResult<string>(executionId, {
        timeout: 10,
        waitPollIntervalMs: 1_000,
      }),
    ).rejects.toMatchObject({ taskId: "unknown", attempt: 0 });
  });

  it("respects timeout budget spent before event-bus wiring", async () => {
    jest.useFakeTimers();
    const nowSpy = jest.spyOn(Date, "now");
    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
    try {
      const store = new MemoryStore();
      const bus = new SilentEventBus();
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

      const executionId = "e-timeout-elapsed-before-subscribe";
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

      const originalGet = store.getExecution.bind(store);
      let calls = 0;
      let nowMs = 1_000;
      nowSpy.mockImplementation(() => nowMs);
      jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
        calls += 1;
        if (calls === 1) {
          // Simulate time spent in initial check before event-bus mode starts.
          nowMs += 50;
        }
        return await originalGet(id);
      });

      const waiting = manager.waitForResult<string>(executionId, {
        timeout: 10,
        waitPollIntervalMs: 1_000,
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const timeoutCalls = setTimeoutSpy.mock.calls.filter(
        (_call) => _call[1] === 10,
      );
      expect(timeoutCalls).toHaveLength(0);

      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      await expect(waiting).rejects.toThrow("Timeout waiting for execution");
    } finally {
      jest.useRealTimers();
      setTimeoutSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it("falls back to polling without a timeout when subscribe() fails", async () => {
    const store = new MemoryStore();
    const bus = {
      publish: async (_channel: string, _event: BusEvent) => undefined,
      subscribe: async () => {
        throw createMessageError("subscribe-failed");
      },
      unsubscribe: async () => undefined,
    } satisfies IEventBus;
    const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

    const executionId = "e-no-timeout-fallback";
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

    const originalGet = store.getExecution.bind(store);
    let calls = 0;
    jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
      calls += 1;
      if (calls >= 3) {
        await store.updateExecution(executionId, {
          status: ExecutionStatus.Completed,
          result: "ok",
          completedAt: new Date(),
        });
      }
      return await originalGet(id);
    });

    const waiting = manager.waitForResult<string>(executionId, {
      waitPollIntervalMs: 5,
    });

    await expect(waiting).resolves.toBe("ok");
  });
});
