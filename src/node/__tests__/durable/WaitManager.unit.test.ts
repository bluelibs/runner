import { WaitManager } from "../../durable/core/managers/WaitManager";
import type { Execution } from "../../durable/core/types";
import * as utils from "../../durable/core/utils";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("WaitManager", () => {
  const baseExecution: Execution = {
    id: "exec-1",
    taskId: "task.test",
    input: undefined,
    status: "running",
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
        return { ...baseExecution, status: "running" };
      }
      return { ...baseExecution, status: "completed", result: { value: 42 } };
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
        return { ...baseExecution, status: "running" };
      }
      return { ...baseExecution, status: "completed", result: { value: 42 } };
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
        return { ...baseExecution, status: "running" };
      }
      return { ...baseExecution, status: "completed", result: { value: 42 } };
    });

    const result = await waitManager.waitForResult<{ value: number }>("exec-1");

    expect(result.value).toBe(42);
    expect(utils.sleepMs).toHaveBeenCalledWith(500);
  });
});
