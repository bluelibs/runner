import {
  AuditLogger,
  PollingManager,
  ScheduleManager,
  TaskRegistry,
} from "../../../../durable/core/managers";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  captureScheduledTimeout,
  createBareStore,
} from "../../helpers/DurableService.unit.helpers";

function createPollingManager(
  store: IDurableStore,
  config: {
    pollIntervalMs?: number;
    concurrency?: number;
    claimTtlMs?: number;
  } = {},
) {
  const taskRegistry = new TaskRegistry();
  const auditLogger = new AuditLogger({}, store);
  const scheduleManager = new ScheduleManager(store, taskRegistry);

  return new PollingManager(
    "worker-1",
    { pollIntervalMs: 1, ...config },
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
  );
}

describe("durable: PollingManager backpressure helpers (unit)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("skips claiming when all polling slots are already in flight", async () => {
    const store = new MemoryStore();
    const manager = createPollingManager(store, { concurrency: 1 });
    const claimReadyTimersSpy = jest.spyOn(store, "claimReadyTimers");
    (
      manager as unknown as { inFlightTimers: Set<Promise<void>> }
    ).inFlightTimers.add(Promise.resolve());

    await (
      manager as unknown as {
        fillAvailableTimerSlots: () => Promise<void>;
      }
    ).fillAvailableTimerSlots();

    expect(claimReadyTimersSpy).not.toHaveBeenCalled();
  });

  it("fails fast when bounded claim-ready polling is unavailable", () => {
    const store = createBareStore(new MemoryStore());
    Object.defineProperty(store, "claimReadyTimers", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(() => createPollingManager(store).start()).toThrow(
      "store.claimReadyTimers()",
    );
  });

  it("consumes pre-requested wake-ups without scheduling a timer", async () => {
    const store = new MemoryStore();
    const manager = createPollingManager(store);

    (manager as unknown as { pollRequested: boolean }).pollRequested = true;

    await (
      manager as unknown as {
        waitForPollingWake: (intervalMs: number) => Promise<void>;
      }
    ).waitForPollingWake(1_000);

    expect(
      (manager as unknown as { pollRequested: boolean }).pollRequested,
    ).toBe(false);
  });

  it("ignores duplicate wait completions after the first wake-up wins", async () => {
    const store = new MemoryStore();
    const manager = createPollingManager(store);
    const scheduledTimeout = captureScheduledTimeout();

    try {
      const waitPromise = (
        manager as unknown as {
          waitForPollingWake: (intervalMs: number) => Promise<void>;
        }
      ).waitForPollingWake(1_000);
      const callback = scheduledTimeout.getScheduledCallback(
        "Expected polling wait callback to be scheduled",
      );

      callback();
      callback();

      await expect(waitPromise).resolves.toBeUndefined();
    } finally {
      scheduledTimeout.restore();
    }
  });

  it.each([
    [{ pollIntervalMs: 0 }, "timers.pollIntervalMs"],
    [{ pollIntervalMs: -1 }, "timers.pollIntervalMs"],
    [{ pollIntervalMs: 1.5 }, "timers.pollIntervalMs"],
    [{ pollIntervalMs: Number.NaN }, "timers.pollIntervalMs"],
    [{ concurrency: 0 }, "timers.concurrency"],
    [{ concurrency: -1 }, "timers.concurrency"],
    [{ concurrency: 1.5 }, "timers.concurrency"],
    [{ concurrency: Number.NaN }, "timers.concurrency"],
    [{ claimTtlMs: 0 }, "timers.claimTtlMs"],
    [{ claimTtlMs: -1 }, "timers.claimTtlMs"],
    [{ claimTtlMs: 1.5 }, "timers.claimTtlMs"],
    [{ claimTtlMs: Number.NaN }, "timers.claimTtlMs"],
  ])("fails fast for invalid polling config %j", (config, configName) => {
    const manager = createPollingManager(new MemoryStore(), config);

    expect(() => manager.start()).toThrow(configName);
  });
});
