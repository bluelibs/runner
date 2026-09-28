import { followContinuedExecutionChain } from "../../../../durable/core/continuedChain";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";

function runningExecution(id: string): Execution {
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

function continuedExecution(id: string, next?: string): Execution {
  return {
    ...runningExecution(id),
    status: ExecutionStatus.ContinuedAsNew,
    continuedAsExecutionId: next,
  };
}

function storeFor(records: Execution[]): {
  store: IDurableStore;
  getExecution: jest.Mock;
} {
  const byId = new Map(records.map((record) => [record.id, record]));
  const getExecution = jest.fn(async (id: string) => byId.get(id) ?? null);
  return {
    store: { getExecution } as unknown as IDurableStore,
    getExecution,
  };
}

describe("durable: followContinuedExecutionChain", () => {
  it("returns a non-continued execution without touching the store", async () => {
    const { store, getExecution } = storeFor([]);
    const execution = runningExecution("live");

    await expect(followContinuedExecutionChain(store, execution)).resolves.toBe(
      execution,
    );
    expect(getExecution).not.toHaveBeenCalled();
  });

  it("follows one hop to the live tip", async () => {
    const tip = runningExecution("tip");
    const { store } = storeFor([tip]);

    await expect(
      followContinuedExecutionChain(store, continuedExecution("root", "tip")),
    ).resolves.toBe(tip);
  });

  it("follows multiple hops to the live tip", async () => {
    const tip = {
      ...runningExecution("tip"),
      status: ExecutionStatus.Completed,
      result: { ok: true },
    };
    const { store } = storeFor([continuedExecution("middle", "tip"), tip]);

    await expect(
      followContinuedExecutionChain(
        store,
        continuedExecution("root", "middle"),
      ),
    ).resolves.toBe(tip);
  });

  it("fails fast on a continued run without a successor link", async () => {
    const { store } = storeFor([]);

    await expect(
      followContinuedExecutionChain(store, continuedExecution("root")),
    ).rejects.toThrow(
      "Continuation chain for execution 'root' is broken: " +
        "status is continued_as_new without a successor link.",
    );
  });

  it("fails fast on a missing successor record", async () => {
    const { store } = storeFor([]);

    await expect(
      followContinuedExecutionChain(store, continuedExecution("root", "ghost")),
    ).rejects.toThrow(
      "Continuation chain for execution 'root' is broken: " +
        "successor 'ghost' does not exist.",
    );
  });

  it("fails fast on a cyclic chain", async () => {
    const { store } = storeFor([
      continuedExecution("middle", "root"),
      continuedExecution("root", "middle"),
    ]);

    await expect(
      followContinuedExecutionChain(
        store,
        continuedExecution("root", "middle"),
      ),
    ).rejects.toThrow(
      "Continuation chain for execution 'root' is cyclic at 'root'.",
    );
  });

  it("fails fast on a self-linked run", async () => {
    const { store } = storeFor([]);

    await expect(
      followContinuedExecutionChain(store, continuedExecution("root", "root")),
    ).rejects.toThrow(
      "Continuation chain for execution 'root' is cyclic at 'root'.",
    );
  });
});
