import { WaitManager } from "../../durable/core/managers/WaitManager";
import type { Execution } from "../../durable/core/types";
import { ExecutionStatus } from "../../durable/core/types";
import * as utils from "../../durable/core/utils";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("WaitManager", () => {
  const baseExecution: Execution = {
    id: "exec-1",
    taskId: "task.test",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(utils, "sleepMs").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses waitPollIntervalMs from options when provided", async () => {
    const store = new MemoryStore();
    const waitManager = new WaitManager(store, undefined, {
      defaultPollIntervalMs: 250,
    });

    const getExecution = jest.spyOn(store, "getExecution");
    getExecution.mockImplementation(async () => {
      if (getExecution.mock.calls.length <= 2) {
        return { ...baseExecution, status: ExecutionStatus.Running };
      }
      return {
        ...baseExecution,
        status: ExecutionStatus.Completed,
        result: { value: 42 },
      };
    });

    const result = await waitManager.waitForResult<{ value: number }>(
      "exec-1",
      {
        waitPollIntervalMs: 123,
      },
    );

    expect(result.value).toBe(42);
    expect(utils.sleepMs).toHaveBeenCalledWith(123);
  });

  it("uses defaultPollIntervalMs from config when option not provided", async () => {
    const store = new MemoryStore();
    const waitManager = new WaitManager(store, undefined, {
      defaultPollIntervalMs: 250,
    });

    const getExecution = jest.spyOn(store, "getExecution");
    getExecution.mockImplementation(async () => {
      if (getExecution.mock.calls.length <= 2) {
        return { ...baseExecution, status: ExecutionStatus.Running };
      }
      return {
        ...baseExecution,
        status: ExecutionStatus.Completed,
        result: { value: 42 },
      };
    });

    const result = await waitManager.waitForResult<{ value: number }>("exec-1");

    expect(result.value).toBe(42);
    expect(utils.sleepMs).toHaveBeenCalledWith(250);
  });

  it("falls back to 500ms when neither options nor config provide an interval", async () => {
    const store = new MemoryStore();
    const waitManager = new WaitManager(store);

    const getExecution = jest.spyOn(store, "getExecution");
    getExecution.mockImplementation(async () => {
      if (getExecution.mock.calls.length <= 2) {
        return { ...baseExecution, status: ExecutionStatus.Running };
      }
      return {
        ...baseExecution,
        status: ExecutionStatus.Completed,
        result: { value: 42 },
      };
    });

    const result = await waitManager.waitForResult<{ value: number }>("exec-1");

    expect(result.value).toBe(42);
    expect(utils.sleepMs).toHaveBeenCalledWith(500);
  });

  it("throws a DurableExecutionError for cancelled executions (default message)", async () => {
    const store = new MemoryStore();
    const waitManager = new WaitManager(store);

    await store.saveExecution({
      ...baseExecution,
      status: ExecutionStatus.Cancelled,
      error: undefined,
      completedAt: new Date(),
    });

    await expect(waitManager.waitForResult("exec-1")).rejects.toThrow(
      "Execution cancelled",
    );
  });

  it("keeps other waiters subscribed when one waiter times out", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const waitManager = new WaitManager(store, bus);

    const executionId = "exec-shared-channel";
    await store.saveExecution({
      ...baseExecution,
      id: executionId,
      status: ExecutionStatus.Pending,
    });

    const firstWaiter = waitManager.waitForResult<string>(executionId, {
      timeout: 30,
      waitPollIntervalMs: 1000,
    });
    const secondWaiter = waitManager.waitForResult<string>(executionId, {
      timeout: 1500,
      waitPollIntervalMs: 1000,
    });

    await expect(firstWaiter).rejects.toThrow("Timeout waiting for execution");

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

    await expect(secondWaiter).resolves.toBe("ok");
  });
});
