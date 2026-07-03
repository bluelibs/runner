import { RecoveryManager } from "../../../../durable/core/managers/RecoveryManager";
import { ExecutionStatus, TimerType } from "../../../../durable/core/types";
import { flushMicrotasks } from "../../helpers/DurableService.unit.helpers";

describe("durable: RecoveryManager coverage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps a sleeping execution parked on a waitForExecution timeout instead of recovering it", () => {
    const manager = new RecoveryManager(
      {} as any,
      { recoverExecution: jest.fn(async () => {}) } as any,
      { error: jest.fn(async () => {}) } as any,
    );
    const sleeping = { id: "e-wait", status: ExecutionStatus.Sleeping };

    // waitForExecution(..., { timeoutMs }) arms a `Timeout` timer; a sleeping
    // parent waiting on a child must be treated as parked, not recovered.
    expect(
      (manager as any).getRecoverabilityDecision(
        sleeping,
        new Map([["e-wait", new Set([TimerType.Timeout])]]),
      ),
    ).toEqual({ kind: "skip", reason: "pending_timer" });

    // No pending wait timer means the sleeper was orphaned and should recover.
    expect(
      (manager as any).getRecoverabilityDecision(
        sleeping,
        new Map<string, Set<TimerType>>(),
      ),
    ).toEqual({ kind: "recover" });
  });

  it("reports recovery failures and exercises claim-state helpers", async () => {
    const store = {
      acquireLock: jest.fn(async () => "lock-1"),
      releaseLock: jest.fn(async () => {}),
      renewLock: jest.fn(async () => true),
    };
    const manager = new RecoveryManager(
      store as any,
      {
        recoverExecution: jest.fn(async () => {
          throw new Error("recovery-boom");
        }),
      } as any,
      { error: jest.fn(async () => {}) } as any,
      { claimTtlMs: 3_000 },
    );

    await expect(
      (manager as any).tryRecoverExecution({
        id: "e-failed-recovery",
        status: ExecutionStatus.Pending,
      }),
    ).resolves.toEqual({
      kind: "failed",
      errorMessage: "recovery-boom",
    });

    const claimState = (manager as any).createClaimState("e-claim");
    claimState.markLost();
    claimState.markLost();
    await expect(claimState.waitForLoss).rejects.toThrow(
      "Recovery claim lost for execution 'e-claim' before recovery finished.",
    );
    expect(claimState.lost).toBe(true);

    const detachedClaimState = (manager as any).createDetachedClaimState();
    detachedClaimState.markLost();
    expect(detachedClaimState.lost).toBe(true);
    expect(detachedClaimState.lossError.message).toBe(
      "detached recovery claim lost",
    );
  });

  it("unrefs heartbeat timers when detached claim tracking is used", async () => {
    const unref = jest.fn();
    const setTimeoutSpy = jest.spyOn(global, "setTimeout").mockImplementation(((
      _callback: TimerHandler,
    ) => ({
      unref,
    })) as unknown as typeof setTimeout);

    const manager = new RecoveryManager(
      {
        acquireLock: jest.fn(async () => "lock-2"),
        releaseLock: jest.fn(async () => {}),
        renewLock: jest.fn(async () => false),
      } as any,
      { recoverExecution: jest.fn(async () => {}) } as any,
      { error: jest.fn(async () => {}) } as any,
    );

    try {
      const stop = (manager as any).startClaimHeartbeat(
        "recovery:execution:e-detached",
        "lock-2",
        3_000,
      );
      await flushMicrotasks();
      stop();
      expect(unref).toHaveBeenCalledTimes(1);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("returns null when recovery throws after the caller has already been aborted", async () => {
    const store = {
      acquireLock: jest.fn(async () => "lock-3"),
      releaseLock: jest.fn(async () => {}),
      renewLock: jest.fn(async () => true),
    };
    const controller = new AbortController();
    const manager = new RecoveryManager(
      store as any,
      {
        recoverExecution: jest.fn(async () => {
          controller.abort();
          throw new Error("late-recovery-error");
        }),
      } as any,
      { error: jest.fn(async () => {}) } as any,
      { claimTtlMs: 3_000 },
    );

    await expect(
      (manager as any).tryRecoverExecution(
        {
          id: "e-aborted-recovery",
          status: ExecutionStatus.Pending,
        },
        controller.signal,
      ),
    ).resolves.toBeNull();
  });
});
