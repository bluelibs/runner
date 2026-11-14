import {
  redriveAfterLockRelease,
  shouldRedriveAfterLockRelease,
} from "../../../../durable/core/managers/ExecutionAttemptRunner.redrive";
import { createExecutionLockState } from "../../../../durable/core/managers/ExecutionManager.locking";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "e-redrive",
    workflowKey: "redrive-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const pausedAt = new Date(1_000);

describe("durable: redrive after lock release", () => {
  it("re-drives when a pause landed and was resumed during the tenure", () => {
    expect(
      shouldRedriveAfterLockRelease({
        lockedSnapshot: createExecution(),
        latest: createExecution({ pausedAt }),
      }),
    ).toBe(true);
  });

  it("re-drives when the holder saw the execution paused under its lock", () => {
    expect(
      shouldRedriveAfterLockRelease({
        lockedSnapshot: createExecution({
          status: ExecutionStatus.Paused,
          pausedAt,
        }),
        latest: createExecution({ status: ExecutionStatus.Pending, pausedAt }),
      }),
    ).toBe(true);
  });

  it("leaves executions alone when no pause touched the tenure", () => {
    expect(
      shouldRedriveAfterLockRelease({
        lockedSnapshot: createExecution({ pausedAt }),
        latest: createExecution({ pausedAt: new Date(pausedAt.getTime()) }),
      }),
    ).toBe(false);
  });

  it("never re-drives missing, still-paused, or terminal executions", () => {
    const lockedSnapshot = createExecution();
    expect(
      shouldRedriveAfterLockRelease({ lockedSnapshot, latest: null }),
    ).toBe(false);
    expect(
      shouldRedriveAfterLockRelease({
        lockedSnapshot,
        latest: createExecution({ status: ExecutionStatus.Paused, pausedAt }),
      }),
    ).toBe(false);
    expect(
      shouldRedriveAfterLockRelease({
        lockedSnapshot,
        latest: createExecution({
          status: ExecutionStatus.Completed,
          pausedAt,
        }),
      }),
    ).toBe(false);
  });
});

describe("durable: redriveAfterLockRelease", () => {
  it.each(["running", "pending", "paused", "completed", null] as const)(
    "checks the latest target before redriving new commands: %s",
    async (status) => {
      const store = new MemoryStore();
      const snapshot = createExecution();
      await store.saveExecution(snapshot);
      await store.enqueueCommand({
        id: "new",
        executionId: snapshot.id,
        requestedExecutionId: snapshot.id,
        taskKey: "change",
        input: undefined,
        status: "pending",
        createdAt: new Date(),
      });
      if (status === null)
        jest.spyOn(store, "getExecution").mockResolvedValue(null);
      else await store.saveExecution({ ...snapshot, status });
      const kickoffExecution = jest.fn(async () => {});
      await redriveAfterLockRelease({
        store,
        lockedSnapshot: snapshot,
        commandAtStart: null,
        lockState: createExecutionLockState(),
        shutdownInterruptionReason: null,
        kickoffExecution,
      });
      expect(kickoffExecution).toHaveBeenCalledTimes(
        status === "running" ? 1 : 0,
      );
    },
  );

  it("leaves an unchanged parked FIFO head to its timer", async () => {
    const store = new MemoryStore();
    const snapshot = createExecution();
    await store.saveExecution(snapshot);
    await store.enqueueCommand({
      id: "parked",
      executionId: snapshot.id,
      requestedExecutionId: snapshot.id,
      taskKey: "change",
      input: undefined,
      status: "running",
      createdAt: new Date(),
    });
    const kickoffExecution = jest.fn(async () => {});
    await redriveAfterLockRelease({
      store,
      lockedSnapshot: snapshot,
      commandAtStart: "parked",
      lockState: createExecutionLockState(),
      shutdownInterruptionReason: null,
      kickoffExecution,
    });
    expect(kickoffExecution).not.toHaveBeenCalled();
    expect(await store.getExecutionTimers(snapshot.id)).toHaveLength(1);
  });

  async function setup(params: {
    lost?: boolean;
    shutdownInterruptionReason?: string | null;
    lockedSnapshot?: Execution | null;
  }) {
    const store = new MemoryStore();
    await store.saveExecution(createExecution({ pausedAt }));
    const lockState = createExecutionLockState();
    lockState.lost = params.lost ?? false;
    const kickoffExecution = jest.fn(async (_executionId: string) => {});
    await redriveAfterLockRelease({
      store,
      lockedSnapshot:
        params.lockedSnapshot === undefined
          ? createExecution()
          : params.lockedSnapshot,
      commandAtStart: null,
      lockState,
      shutdownInterruptionReason: params.shutdownInterruptionReason ?? null,
      kickoffExecution,
    });
    return kickoffExecution;
  }

  it("re-kicks an execution resumed while the lock was held", async () => {
    const kickoffExecution = await setup({});
    expect(kickoffExecution).toHaveBeenCalledWith("e-redrive");
  });

  it("stays out of the way without a snapshot, after lock loss, or during shutdown", async () => {
    expect(await setup({ lockedSnapshot: null })).not.toHaveBeenCalled();
    expect(await setup({ lost: true })).not.toHaveBeenCalled();
    expect(
      await setup({ shutdownInterruptionReason: "shutting down" }),
    ).not.toHaveBeenCalled();
  });
});
