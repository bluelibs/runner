import { WaitManager } from "../../../../durable/core/managers/WaitManager";
import type { Execution } from "../../../../durable/core/types";
import { ExecutionStatus } from "../../../../durable/core/types";
import * as utils from "../../../../durable/core/utils";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

function baseExecution(id: string): Execution {
  return {
    id,
    workflowKey: "chain-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("durable: WaitManager continuation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(utils, "sleepMs").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves a wait on a continued run with the live tip outcome", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      ...baseExecution("root"),
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: "middle",
    });
    await store.saveExecution({
      ...baseExecution("middle"),
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: "tip",
    });
    await store.saveExecution({
      ...baseExecution("tip"),
      status: ExecutionStatus.Completed,
      result: { value: 42 },
    });
    const waitManager = new WaitManager(store);

    const result = await waitManager.waitForResult<{ value: number }>("root");

    expect(result).toEqual({ value: 42 });
  });

  it("fails fast on a continued run without a successor link", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      ...baseExecution("root"),
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: undefined,
    });
    const waitManager = new WaitManager(store);

    await expect(waitManager.waitForResult("root")).rejects.toThrow(
      "Continuation chain for execution root is broken at root",
    );
  });

  it("reports a broken link without a workflow key as unknown", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      ...baseExecution("root"),
      workflowKey: "",
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: undefined,
    });
    const waitManager = new WaitManager(store);

    const failure = await waitManager.waitForResult("root").then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      message: "Continuation chain for execution root is broken at root",
      executionId: "root",
      workflowKey: "unknown",
    });
  });

  it("fails fast on a cyclic continuation chain", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      ...baseExecution("root"),
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: "root",
    });
    const waitManager = new WaitManager(store);

    await expect(waitManager.waitForResult("root")).rejects.toThrow(
      "Continuation chain for execution root is cyclic at root",
    );
  });

  it("reports a missing successor record as not found", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      ...baseExecution("root"),
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: "ghost",
    });
    const waitManager = new WaitManager(store);

    await expect(waitManager.waitForResult("root")).rejects.toThrow(
      "Execution ghost not found",
    );
  });
});
