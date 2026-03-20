import type { IDurableStore } from "../../durable/core/interfaces/store";
import {
  AuditLogger,
  PollingManager,
  ScheduleManager,
  TaskRegistry,
} from "../../durable/core/managers";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { Logger, type ILog } from "../../../models/Logger";

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

describe("durable: PollingManager heartbeat (unit)", () => {
  it("returns a no-op heartbeat stopper when claim renewal is unavailable", () => {
    const store = {} as IDurableStore;
    const manager = createPollingManager(store);

    const stopHeartbeat = (
      manager as unknown as {
        startTimerClaimHeartbeat: (
          timerId: string,
          claimTtlMs: number,
          claimState: { lossError: Error | null },
        ) => () => void;
      }
    ).startTimerClaimHeartbeat("timer-1", 3_000, { lossError: null });

    expect(stopHeartbeat).toBeInstanceOf(Function);
    expect(() => stopHeartbeat()).not.toThrow();
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

    const stopHeartbeat = (
      manager as unknown as {
        startTimerClaimHeartbeat: (
          timerId: string,
          claimTtlMs: number,
          claimState: { lossError: Error | null },
        ) => () => void;
      }
    ).startTimerClaimHeartbeat("timer-overlap", 3_000, { lossError: null });

    await waitMs(1_100);
    expect(renewTimerClaimSpy).toHaveBeenCalledTimes(1);

    await waitMs(1_100);
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
    const claimState = {
      lossError: existingLoss,
    };

    const stopHeartbeat = (
      manager as unknown as {
        startTimerClaimHeartbeat: (
          timerId: string,
          claimTtlMs: number,
          claimState: { lossError: Error | null },
        ) => () => void;
      }
    ).startTimerClaimHeartbeat("timer-existing-loss", 3_000, claimState);

    await waitMs(1_100);
    await Promise.resolve();

    expect(claimState.lossError).toBe(existingLoss);
    stopHeartbeat();
  });

  it("logs timer-claim heartbeat failures and records claim loss", async () => {
    const store = new MemoryStore();
    const logs: ILog[] = [];
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    logger.onLog((log) => {
      logs.push(log);
    });
    jest
      .spyOn(store, "renewTimerClaim")
      .mockRejectedValue(new Error("renew exploded"));
    const manager = createPollingManager(store, logger);
    const claimState = {
      lossError: null as Error | null,
    };

    const stopHeartbeat = (
      manager as unknown as {
        startTimerClaimHeartbeat: (
          timerId: string,
          claimTtlMs: number,
          claimState: { lossError: Error | null },
        ) => () => void;
      }
    ).startTimerClaimHeartbeat("timer-reject", 3_000, claimState);

    await waitMs(1_100);
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
