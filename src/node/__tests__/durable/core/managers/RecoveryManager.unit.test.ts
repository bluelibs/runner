import { Semaphore } from "../../../../../models/Semaphore";
import { DurableService } from "../../../../durable/core/DurableService";
import { RecoveryManager } from "../../../../durable/core/managers/RecoveryManager";
import { ExecutionStatus } from "../../../../durable/core/types";
import { flushMicrotasks } from "../../helpers/DurableService.unit.helpers";

describe("durable: RecoveryManager (unit)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function createManager(
    overrides: {
      store?: object;
      executionManager?: object;
      logger?: object;
      config?: object;
    } = {},
  ) {
    const store =
      overrides.store ??
      ({
        listIncompleteExecutions: jest.fn(async () => []),
        getReadyTimers: jest.fn(async () => []),
        acquireLock: jest.fn(async () => "lock-1"),
        releaseLock: jest.fn(async () => {}),
      } as const);

    const executionManager =
      overrides.executionManager ??
      ({
        recoverExecution: jest.fn(async () => {}),
      } as const);

    const logger =
      overrides.logger ??
      ({
        error: jest.fn(async () => {}),
      } as const);

    return {
      manager: new RecoveryManager(
        store as any,
        executionManager as any,
        logger as any,
        overrides.config as any,
      ),
      store,
      executionManager,
      logger,
    };
  }

  it("ignores duplicate background starts and logs top-level recovery failures", async () => {
    const { manager, store, logger } = createManager({
      store: {
        listIncompleteExecutions: jest.fn(async () => {
          throw new Error("boom");
        }),
        getReadyTimers: jest.fn(async () => []),
        acquireLock: jest.fn(async () => "lock-1"),
        releaseLock: jest.fn(async () => {}),
      },
    });

    manager.startBackgroundRecovery();
    manager.startBackgroundRecovery();
    await flushMicrotasks();
    await manager.stopBackgroundRecovery();

    expect(
      (store as { listIncompleteExecutions: jest.Mock })
        .listIncompleteExecutions,
    ).toHaveBeenCalledTimes(1);
    expect((logger as { error: jest.Mock }).error).toHaveBeenCalledWith(
      "Durable startup recovery failed.",
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
  });

  it("registers the recovery stop handler only once", async () => {
    const service = new DurableService({
      store: {} as any,
    });
    const recoveryManager = (service as any).recoveryManager as RecoveryManager;
    const startSpy = jest
      .spyOn(recoveryManager, "startBackgroundRecovery")
      .mockImplementation(() => {});
    const stopSpy = jest
      .spyOn(recoveryManager, "stopBackgroundRecovery")
      .mockResolvedValue();

    service.startRecoveryOnInit();
    service.startRecoveryOnInit();
    await service.stop();

    expect(startSpy).toHaveBeenCalledTimes(2);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("returns on aborted permit waits and rethrows non-abort permit failures", async () => {
    const { manager } = createManager();
    const semaphore = new Semaphore(1);
    await semaphore.acquire();

    const controller = new AbortController();
    const abortedWait = (manager as any).withRecoveryPermit(
      semaphore,
      controller.signal,
      async () => {},
    );
    controller.abort();
    await expect(abortedWait).resolves.toBeUndefined();
    semaphore.release();

    await expect(
      (manager as any).withRecoveryPermit(
        new Semaphore(1),
        undefined,
        async () => {
          throw new Error("permit-failed");
        },
      ),
    ).rejects.toThrow("permit-failed");
  });

  it("skips work when the drain signal aborts before a recovery callback runs", async () => {
    const controller = new AbortController();
    const { manager } = createManager({
      store: {
        listIncompleteExecutions: jest.fn(async () => [
          { id: "e1", status: ExecutionStatus.Pending },
        ]),
        getReadyTimers: jest.fn(async () => []),
      },
    });

    const withPermitSpy = jest
      .spyOn(Semaphore.prototype, "withPermit")
      .mockImplementation(async (fn) => {
        controller.abort();
        return await fn();
      });

    const report = await (manager as any).runDrain(controller.signal);

    expect(report).toEqual({
      scannedCount: 0,
      recoveredCount: 0,
      skippedCount: 0,
      failedCount: 0,
      recovered: [],
      skipped: [],
      failures: [],
    });

    withPermitSpy.mockRestore();
  });

  it("returns null when recovery is aborted before or right after claiming", async () => {
    const { manager } = createManager();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();

    await expect(
      (manager as any).tryRecoverExecution(
        { id: "e1", status: ExecutionStatus.Pending },
        alreadyAborted.signal,
      ),
    ).resolves.toBeNull();

    const midClaimAbort = new AbortController();
    const releaseLock = jest.fn(async () => {});
    const recoverExecution = jest.fn(async () => {});
    const abortingManager = new RecoveryManager(
      {
        acquireLock: jest.fn(async () => {
          midClaimAbort.abort();
          return "lock-2";
        }),
        releaseLock,
      } as any,
      {
        recoverExecution,
      } as any,
      { error: jest.fn(async () => {}) } as any,
    );

    await expect(
      (abortingManager as any).tryRecoverExecution(
        { id: "e2", status: ExecutionStatus.Pending },
        midClaimAbort.signal,
      ),
    ).resolves.toBeNull();
    expect(recoverExecution).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledWith("recovery:execution:e2", "lock-2");
  });
});
