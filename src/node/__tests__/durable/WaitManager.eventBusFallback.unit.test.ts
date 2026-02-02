import type { BusEvent, IEventBus } from "../../durable/core/interfaces/bus";
import { WaitManager } from "../../durable/core/managers/WaitManager";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";

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
      if (calls === 3) {
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
        throw new Error("getExecution-failed");
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
});
