import { WaitManager } from "../core/managers/WaitManager";
import type { Execution } from "../core/types";
import { sleepMs } from "../core/utils";
import { MemoryStore } from "../store/MemoryStore";

jest.mock("../core/utils", () => {
  const actual = jest.requireActual("../core/utils");
  return {
    ...actual,
    sleepMs: jest.fn(async () => {}),
  };
});

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
    expect(sleepMs).toHaveBeenCalledWith(123);
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
    expect(sleepMs).toHaveBeenCalledWith(250);
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
    expect(sleepMs).toHaveBeenCalledWith(500);
  });
});
