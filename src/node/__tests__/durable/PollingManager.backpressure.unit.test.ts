import {
  AuditLogger,
  PollingManager,
  ScheduleManager,
  TaskRegistry,
} from "../../durable/core/managers";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  captureScheduledTimeout,
  createBareStore,
} from "./DurableService.unit.helpers";

function createPollingManager(
  store: IDurableStore,
  config: { interval?: number; concurrency?: number; claimTtlMs?: number } = {},
) {
  const taskRegistry = new TaskRegistry();
  const auditLogger = new AuditLogger({}, store);
  const scheduleManager = new ScheduleManager(store, taskRegistry);

  return new PollingManager(
    "worker-1",
    { interval: 1, ...config },
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
    [{ interval: 0 }, "polling.interval"],
    [{ interval: -1 }, "polling.interval"],
    [{ interval: 1.5 }, "polling.interval"],
    [{ interval: Number.NaN }, "polling.interval"],
    [{ concurrency: 0 }, "polling.concurrency"],
    [{ concurrency: -1 }, "polling.concurrency"],
    [{ concurrency: 1.5 }, "polling.concurrency"],
    [{ concurrency: Number.NaN }, "polling.concurrency"],
    [{ claimTtlMs: 0 }, "polling.claimTtlMs"],
    [{ claimTtlMs: -1 }, "polling.claimTtlMs"],
    [{ claimTtlMs: 1.5 }, "polling.claimTtlMs"],
    [{ claimTtlMs: Number.NaN }, "polling.claimTtlMs"],
  ])("fails fast for invalid polling config %j", (config, configName) => {
    const manager = createPollingManager(new MemoryStore(), config);

    expect(() => manager.start()).toThrow(configName);
  });
});
