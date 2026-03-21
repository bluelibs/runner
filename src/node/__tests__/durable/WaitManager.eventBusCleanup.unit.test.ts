import type { BusEvent, IEventBus } from "../../durable/core/interfaces/bus";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { WaitManager } from "../../durable/core/managers/WaitManager";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { genericError } from "../../../errors";

class SilentEventBus implements IEventBus {
  async publish(_channel: string, _event: BusEvent): Promise<void> {}
  async subscribe(
    _channel: string,
    _handler: (event: BusEvent) => Promise<void>,
  ): Promise<void> {}
  async unsubscribe(_channel: string): Promise<void> {}
}

describe("durable: WaitManager (event bus cleanup)", () => {
  it("does not resume polling when a queued poll timer fires after timeout", async () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryStore();
      const bus = new SilentEventBus();
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

      const executionId = "e-queued-poll-after-timeout";
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
        return await originalGet(id);
      });

      const waiting = manager.waitForResult<string>(executionId, {
        timeout: 10,
        waitPollIntervalMs: 1,
      });

      for (let i = 0; i < 10 && calls < 3; i += 1) {
        await Promise.resolve();
      }
      expect(calls).toBe(3);

      await jest.advanceTimersByTimeAsync(10);
      await expect(waiting).rejects.toThrow("Timeout waiting for execution");

      const callsAfterTimeout = calls;
      await jest.advanceTimersByTimeAsync(1);

      expect(calls).toBe(callsAfterTimeout);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not schedule another poll after timeout has already settled the wait", async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
    try {
      const store = new MemoryStore();
      const bus = new SilentEventBus();
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

      const executionId = "e-no-late-poll";
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
      let releaseBlockedCheck = () => {};
      const blockedCheck = new Promise<void>((resolve) => {
        releaseBlockedCheck = resolve;
      });

      jest.spyOn(store, "getExecution").mockImplementation(async (id) => {
        calls += 1;
        if (calls === 3) {
          await blockedCheck;
        }
        return await originalGet(id);
      });

      const waiting = manager.waitForResult<string>(executionId, {
        timeout: 10,
        waitPollIntervalMs: 1_000,
      });

      for (let i = 0; i < 10 && calls < 3; i += 1) {
        await Promise.resolve();
      }
      expect(calls).toBe(3);

      jest.advanceTimersByTime(10);
      await Promise.resolve();
      releaseBlockedCheck();
      await Promise.resolve();
      await Promise.resolve();

      await expect(waiting).rejects.toThrow("Timeout waiting for execution");

      const pollTimers = setTimeoutSpy.mock.calls.filter(
        (_call) => _call[1] === 1_000,
      );
      expect(pollTimers).toHaveLength(0);
    } finally {
      jest.useRealTimers();
      setTimeoutSpy.mockRestore();
    }
  });

  it("skips polling fallback when subscribe fails after timeout already settled the wait", async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
    try {
      const store = new MemoryStore();
      const bus = {
        publish: async (_channel: string, _event: BusEvent) => undefined,
        subscribe: async () => {
          await new Promise<void>((_, reject) => {
            setTimeout(() => {
              reject(genericError.new({ message: "subscribe-failed" }));
            }, 20);
          });
        },
        unsubscribe: async () => undefined,
      } satisfies IEventBus;
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

      const executionId = "e-subscribe-fails-after-timeout";
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
        timeout: 10,
        waitPollIntervalMs: 1_000,
      });

      jest.advanceTimersByTime(10);
      await Promise.resolve();
      jest.advanceTimersByTime(20);
      await Promise.resolve();

      await expect(waiting).rejects.toThrow("Timeout waiting for execution");

      const pollTimers = setTimeoutSpy.mock.calls.filter(
        (_call) => _call[1] === 1_000,
      );
      expect(pollTimers).toHaveLength(0);
    } finally {
      jest.useRealTimers();
      setTimeoutSpy.mockRestore();
    }
  });

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

  it("ignores a queued poll timer when completion happens before the callback runs", async () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryStore();
      const bus = new SilentEventBus();
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

      const executionId = "e-done-before-poll-callback";
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
        waitPollIntervalMs: 50,
      });

      await Promise.resolve();
      await Promise.resolve();
      await store.updateExecution(executionId, {
        status: ExecutionStatus.Completed,
        result: "ok",
        completedAt: new Date(),
      });
      jest.advanceTimersByTime(50);

      await expect(waiting).resolves.toBe("ok");
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops a poll callback when the wait settles while the store check is still in flight", async () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryStore();
      const bus = new MemoryEventBus();
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

      const executionId = "e-done-during-poll-check";
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

      for (let i = 0; i < 10 && calls < 4; i += 1) {
        await Promise.resolve();
      }
      expect(calls).toBe(4);

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
      releaseCheck();

      await expect(waiting).resolves.toBe("ok");
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns early when a queued poll callback runs after the event bus already completed the wait", async () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryStore();
      const bus = new MemoryEventBus();
      const manager = new WaitManager(store, bus, { defaultPollIntervalMs: 5 });

      const executionId = "e-bus-finishes-before-poll";
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
        waitPollIntervalMs: 10,
      });

      await Promise.resolve();
      await Promise.resolve();
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
      jest.advanceTimersByTime(10);

      await expect(waiting).resolves.toBe("ok");
    } finally {
      jest.useRealTimers();
    }
  });
});
