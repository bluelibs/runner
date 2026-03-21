import {
  AuditLogger,
  PollingManager,
  ScheduleManager,
  TaskRegistry,
} from "../../durable/core/managers";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { Logger } from "../../../models/Logger";
import {
  advanceTimers,
  captureScheduledTimeout,
  createBufferedLogger,
} from "./DurableService.unit.helpers";

type TestPollingManager = {
  startTimerClaimHeartbeat: (
    timerId: string,
    claimTtlMs: number,
    claimState: { lossError: Error | null },
  ) => () => void;
};

function createPollingManager(store: IDurableStore, logger?: Logger) {
  const taskRegistry = new TaskRegistry();
  const auditLogger = new AuditLogger({}, store);
  const scheduleManager = new ScheduleManager(store, taskRegistry);

  return new PollingManager(
    "worker-1",
    { interval: 1 },
    store,
    undefined,
    3,
    undefined,
    taskRegistry,
    auditLogger,
    scheduleManager,
    {
      processExecution: jest.fn(async () => {}),
      kickoffExecution: jest.fn(async () => {}),
    },
    logger,
  );
}

function startTimerClaimHeartbeat(
  manager: PollingManager,
  timerId: string,
  claimState: { lossError: Error | null } = { lossError: null },
): () => void {
  return (manager as unknown as TestPollingManager).startTimerClaimHeartbeat(
    timerId,
    3_000,
    claimState,
  );
}

describe("durable: PollingManager heartbeat (unit)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns a no-op heartbeat stopper when claim renewal is unavailable", () => {
    const store = {} as IDurableStore;
    const manager = createPollingManager(store);
    const stopHeartbeat = startTimerClaimHeartbeat(manager, "timer-1");

    expect(stopHeartbeat).toBeInstanceOf(Function);
    expect(() => stopHeartbeat()).not.toThrow();
  });

  it("ignores an already-scheduled renewal callback after the heartbeat is stopped", async () => {
    const store = new MemoryStore();
    const renewTimerClaimSpy = jest.spyOn(store, "renewTimerClaim");
    const manager = createPollingManager(store);
    const scheduledTimeout = captureScheduledTimeout();

    try {
      const stopHeartbeat = startTimerClaimHeartbeat(
        manager,
        "timer-stopped-callback",
      );

      stopHeartbeat();
      const callback = scheduledTimeout.getScheduledCallback(
        "Expected timer-claim heartbeat callback to be scheduled",
      );
      callback();
      await Promise.resolve();

      expect(renewTimerClaimSpy).not.toHaveBeenCalled();
    } finally {
      scheduledTimeout.restore();
    }
  });

  it("does not require timer handles to expose unref", () => {
    const store = new MemoryStore();
    const manager = createPollingManager(store);
    const mockSetTimeout = (() => ({})) as unknown as typeof setTimeout;
    const setTimeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation(mockSetTimeout);

    try {
      const stopHeartbeat = startTimerClaimHeartbeat(manager, "timer-no-unref");

      expect(stopHeartbeat).toBeInstanceOf(Function);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("stops cleanly after a timer-claim renewal has already started", async () => {
    const store = new MemoryStore();
    let resolveRenewal!: (value: boolean) => void;
    jest.spyOn(store, "renewTimerClaim").mockImplementation(
      async () =>
        await new Promise<boolean>((resolve) => {
          resolveRenewal = resolve;
        }),
    );
    const manager = createPollingManager(store);
    const scheduledTimeout = captureScheduledTimeout();

    try {
      const stopHeartbeat = startTimerClaimHeartbeat(
        manager,
        "timer-in-flight-stop",
      );

      const callback = scheduledTimeout.getScheduledCallback(
        "Expected timer-claim heartbeat callback to be scheduled",
      );
      callback();
      stopHeartbeat();
      resolveRenewal(true);
      await Promise.resolve();
      await Promise.resolve();

      expect(scheduledTimeout.clearTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      scheduledTimeout.restore();
    }
  });

  it("does not overlap timer-claim renewals while one renewal is still pending", async () => {
    const store = new MemoryStore();
    let resolveRenewal!: (value: boolean) => void;
    const renewTimerClaimSpy = jest
      .spyOn(store, "renewTimerClaim")
      .mockImplementation(
        async () =>
          await new Promise<boolean>((resolve) => {
            resolveRenewal = resolve;
          }),
      );
    const manager = createPollingManager(store);
    const stopHeartbeat = startTimerClaimHeartbeat(manager, "timer-overlap");

    await advanceTimers(1_100);
    expect(renewTimerClaimSpy).toHaveBeenCalledTimes(1);

    await advanceTimers(1_100);
    expect(renewTimerClaimSpy).toHaveBeenCalledTimes(1);

    resolveRenewal(true);
    await Promise.resolve();
    await Promise.resolve();
    stopHeartbeat();
  });

  it("preserves an existing claim-loss error when another renewal failure arrives", async () => {
    const store = new MemoryStore();
    jest.spyOn(store, "renewTimerClaim").mockResolvedValue(false);
    const manager = createPollingManager(store);
    const existingLoss = new Error("already lost");
    const claimState = { lossError: existingLoss };
    const stopHeartbeat = startTimerClaimHeartbeat(
      manager,
      "timer-existing-loss",
      claimState,
    );

    await advanceTimers(1_100);
    await Promise.resolve();

    expect(claimState.lossError).toBe(existingLoss);
    stopHeartbeat();
  });

  it("logs timer-claim heartbeat failures and records claim loss", async () => {
    const store = new MemoryStore();
    const { logger, logs } = createBufferedLogger();
    jest
      .spyOn(store, "renewTimerClaim")
      .mockRejectedValue(new Error("renew exploded"));
    const manager = createPollingManager(store, logger);
    const claimState = { lossError: null as Error | null };
    const stopHeartbeat = startTimerClaimHeartbeat(
      manager,
      "timer-reject",
      claimState,
    );

    await advanceTimers(1_100);
    await Promise.resolve();

    expect(claimState.lossError?.message).toContain(
      "Timer-claim heartbeat failed",
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          message: "Durable timer-claim heartbeat failed.",
        }),
      ]),
    );
    stopHeartbeat();
  });
});
