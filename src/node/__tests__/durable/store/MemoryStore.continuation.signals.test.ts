import { MemoryStore } from "../../../durable/store/MemoryStore";
import {
  ExecutionStatus,
  MAX_QUEUED_SIGNALS_PER_KEY,
  type Execution,
} from "../../../durable/core/types";

function execution(
  id: string,
  status: ExecutionStatus,
  overrides: Partial<Execution> = {},
): Execution {
  return {
    id,
    workflowKey: "continue-task",
    input: undefined,
    status,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function continueRoot(store: MemoryStore): Promise<boolean> {
  return store.createContinuedExecution({
    priorExecution: execution("root", ExecutionStatus.ContinuedAsNew, {
      continuedAsExecutionId: "tip",
    }),
    successorExecution: execution("tip", ExecutionStatus.Pending, {
      continuedFromExecutionId: "root",
    }),
  });
}

const record = (id: string, n: number) => ({
  id,
  payload: { n },
  receivedAt: new Date(),
});

describe("durable: MemoryStore continuation signal backlog", () => {
  it("moves every queued signal backlog to the successor in the commit", async () => {
    const store = new MemoryStore();
    await store.saveExecution(execution("root", ExecutionStatus.Running));
    await store.bufferSignalRecord("root", "a", record("a1", 1));
    await store.bufferSignalRecord("root", "a", record("a2", 2));
    await store.bufferSignalRecord("root", "b", record("b1", 3));
    await store.appendSignalRecord("root", "c", record("c1", 4));

    await expect(continueRoot(store)).resolves.toBe(true);

    expect((await store.getSignalState("tip", "a"))?.queued).toEqual([
      expect.objectContaining({ id: "a1" }),
      expect.objectContaining({ id: "a2" }),
    ]);
    expect((await store.getSignalState("tip", "b"))?.queued).toEqual([
      expect.objectContaining({ id: "b1" }),
    ]);
    expect(await store.getSignalState("tip", "c")).toBeNull();
    const priorA = await store.getSignalState("root", "a");
    expect(priorA?.queued).toEqual([]);
    // The prior run's journal keeps what it received.
    expect(priorA?.history).toHaveLength(2);
  });

  it("leaves the backlog in place when the commit is dropped", async () => {
    const store = new MemoryStore();
    await store.saveExecution(execution("root", ExecutionStatus.Paused));
    await store.bufferSignalRecord("root", "a", record("a1", 1));

    await expect(continueRoot(store)).resolves.toBe(false);

    expect((await store.getSignalState("root", "a"))?.queued).toHaveLength(1);
    expect(await store.getSignalState("tip", "a")).toBeNull();
  });

  it("refuses to overflow a successor backlog past the per-key cap", async () => {
    const store = new MemoryStore();
    await store.saveExecution(execution("root", ExecutionStatus.Running));
    await store.bufferSignalRecord("root", "a", record("a1", 1));
    for (let index = 0; index < MAX_QUEUED_SIGNALS_PER_KEY; index += 1) {
      await store.enqueueQueuedSignalRecord("tip", "a", record(`t${index}`, 0));
    }

    await expect(continueRoot(store)).rejects.toThrow("backlog");
    expect((await store.getExecution("root"))?.status).toBe(
      ExecutionStatus.Running,
    );
    expect(await store.getExecution("tip")).toBeNull();
  });
});
