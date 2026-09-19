import type { Execution } from "../../../durable/core/types";
import { ExecutionStatus } from "../../../durable/core/types";
import {
  serializer,
  setupRedisStoreMock,
} from "../helpers/RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

function runningExecution(): Execution {
  return {
    id: "root",
    workflowKey: "continue-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function closedPrior(): Execution {
  return {
    ...runningExecution(),
    status: ExecutionStatus.ContinuedAsNew,
    continuedAsExecutionId: "tip",
    completedAt: new Date(),
  };
}

function successor(): Execution {
  return {
    ...runningExecution(),
    id: "tip",
    status: ExecutionStatus.Pending,
    continuedFromExecutionId: "root",
  };
}

describe("durable: RedisStore continuation (mock)", () => {
  it("commits the close-and-create when the prior run is running", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(1);

    await expect(
      store.createContinuedExecution({
        priorExecution: closedPrior(),
        successorExecution: successor(),
      }),
    ).resolves.toBe(true);

    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    const args = redisMock.eval.mock.calls[0] as unknown[];
    // Script, key count, and 7 keys precede ARGV[1].
    // Prior payload and id, then prior flags: continued_as_new is inactive.
    expect(args[9]).toContain('"status":"continued_as_new"');
    expect(args[10]).toBe("root");
    expect(args[11]).toBe("0");
    // Successor payload and id, then successor flags: pending is active.
    expect(args[13]).toContain('"status":"pending"');
    expect(args[14]).toBe("tip");
    expect(args[15]).toBe("1");
    // The commit is conditional on the prior run still running.
    expect(args[args.length - 1]).toBe(ExecutionStatus.Running);
  });

  it("drops the commit when the prior run is no longer running", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(0);

    await expect(
      store.createContinuedExecution({
        priorExecution: closedPrior(),
        successorExecution: successor(),
      }),
    ).resolves.toBe(false);
  });

  it("surfaces corrupt execution payloads as store errors", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(
      "__error__:Corrupted durable execution payload",
    );

    await expect(
      store.createContinuedExecution({
        priorExecution: closedPrior(),
        successorExecution: successor(),
      }),
    ).rejects.toThrow("Corrupted durable execution payload");
  });

  it("saves and reads workflow state records", async () => {
    const { redisMock, store } = harness;
    const record = {
      executionId: "root",
      state: { page: 1 },
      updatedAt: new Date(),
    };

    await store.saveWorkflowState(record);
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining("workflow_state:root"),
      serializer.stringify(record),
    );

    redisMock.get.mockResolvedValueOnce(serializer.stringify(record));
    await expect(store.getWorkflowState("root")).resolves.toMatchObject({
      executionId: "root",
      state: { page: 1 },
    });
    expect(redisMock.get).toHaveBeenCalledWith(
      expect.stringContaining("workflow_state:root"),
    );
  });

  it("resolves missing workflow state to null", async () => {
    const { redisMock, store } = harness;
    redisMock.get.mockResolvedValueOnce(null);

    await expect(store.getWorkflowState("root")).resolves.toBeNull();
  });

  it("passes the accepted step target to the waiter commit script", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce(1);

    await store.commitExecutionWaiterCompletion({
      targetExecutionId: "tip",
      executionId: "parent",
      stepId: "__execution:child",
      stepResult: {
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "completed",
          targetExecutionId: "child",
          workflowKey: "child-task",
          result: { ok: true },
        },
        completedAt: new Date(),
      },
      waitTargetExecutionId: "child",
    });

    const args = redisMock.eval.mock.calls[0] as unknown[];
    expect(args[args.length - 1]).toBe("child");
    expect(args[args.length - 2]).toBe("");
  });
});
