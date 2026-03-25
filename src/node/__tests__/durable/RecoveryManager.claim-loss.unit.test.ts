import { RecoveryManager } from "../../durable/core/managers/RecoveryManager";
import { ExecutionStatus } from "../../durable/core/types";
import {
  captureScheduledTimeout,
  flushMicrotasks,
} from "./DurableService.unit.helpers";

describe("durable: RecoveryManager claim loss", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("abandons recovery when the claim can no longer be renewed", async () => {
    let releaseRecovery!: () => void;
    const recoverExecution = jest.fn(
      async () =>
        await new Promise<void>((resolve) => {
          releaseRecovery = resolve;
        }),
    );
    const store = {
      acquireLock: jest.fn(async () => "lock-1"),
      releaseLock: jest.fn(async () => {}),
      renewLock: jest.fn(async () => false),
    };
    const manager = new RecoveryManager(
      store as any,
      { recoverExecution } as any,
      { error: jest.fn(async () => {}) } as any,
      { claimTtlMs: 3_000 },
    );
    const scheduledTimeout = captureScheduledTimeout();

    const recovery = (manager as any).tryRecoverExecution({
      id: "e1",
      status: ExecutionStatus.Pending,
    });

    await flushMicrotasks();
    scheduledTimeout.getScheduledCallback(
      "Expected recovery heartbeat timeout to be scheduled",
    )();
    await flushMicrotasks();

    await expect(recovery).resolves.toBeNull();
    expect(store.renewLock).toHaveBeenCalledWith(
      "recovery:execution:e1",
      "lock-1",
      3_000,
    );
    expect(store.releaseLock).toHaveBeenCalledWith(
      "recovery:execution:e1",
      "lock-1",
    );

    releaseRecovery();
    await flushMicrotasks();
    scheduledTimeout.restore();
  });

  it("reschedules heartbeats while the claim is still owned", async () => {
    const store = {
      acquireLock: jest.fn(async () => "lock-1"),
      releaseLock: jest.fn(async () => {}),
      renewLock: jest.fn(async () => true),
    };
    const manager = new RecoveryManager(
      store as any,
      { recoverExecution: jest.fn(async () => {}) } as any,
      { error: jest.fn(async () => {}) } as any,
      { claimTtlMs: 3_000 },
    );
    const scheduledTimeout = captureScheduledTimeout();
    const claimState = (manager as any).createClaimState("e-reschedule");

    const stopHeartbeat = (manager as any).startClaimHeartbeat(
      "recovery:execution:e-reschedule",
      "lock-1",
      3_000,
      claimState,
    );

    scheduledTimeout.getScheduledCallback("expected first heartbeat")();
    await flushMicrotasks();
    scheduledTimeout.getScheduledCallback("expected rescheduled heartbeat")();
    await flushMicrotasks();

    expect(store.renewLock).toHaveBeenCalledTimes(2);

    stopHeartbeat();
    scheduledTimeout.restore();
  });

  it("reports recovery as completed when recovery wins the race before a same-turn claim-loss microtask", async () => {
    let rejectLoss!: (error: Error) => void;
    const claimState = {
      lost: false,
      lossError: new Error("claim-lost"),
      waitForLoss: new Promise<never>((_, reject) => {
        rejectLoss = reject;
      }),
      markLost: () => {
        if (claimState.lost) {
          return;
        }
        claimState.lost = true;
        rejectLoss(claimState.lossError);
      },
    };
    void claimState.waitForLoss.catch(() => {});

    const store = {
      acquireLock: jest.fn(async () => "lock-1"),
      releaseLock: jest.fn(async () => {}),
      renewLock: jest.fn(async () => true),
    };
    const manager = new RecoveryManager(
      store as any,
      {
        recoverExecution: jest.fn(() => {
          const recovery = Promise.resolve();
          void recovery.then(() => {
            queueMicrotask(() => {
              claimState.markLost();
            });
          });
          return recovery;
        }),
      } as any,
      { error: jest.fn(async () => {}) } as any,
      { claimTtlMs: 3_000 },
    );

    jest
      .spyOn(manager as any, "createClaimState")
      .mockReturnValue(claimState as any);
    jest.spyOn(manager as any, "startClaimHeartbeat").mockReturnValue(() => {});

    await expect(
      (manager as any).tryRecoverExecution({
        id: "e-race",
        status: ExecutionStatus.Pending,
      }),
    ).resolves.toEqual({ kind: "recovered" });
  });

  it("supports detached and duplicate claim-loss notifications", async () => {
    const manager = new RecoveryManager(
      {} as any,
      { recoverExecution: jest.fn(async () => {}) } as any,
      { error: jest.fn(async () => {}) } as any,
    );

    const claimState = (manager as any).createClaimState("e-duplicate");
    claimState.markLost();
    claimState.markLost();
    await expect(claimState.waitForLoss).rejects.toThrow(
      "Recovery claim lost for execution 'e-duplicate'",
    );

    const detached = (manager as any).createDetachedClaimState();
    detached.markLost();
    expect(detached.lost).toBe(true);
  });
});
