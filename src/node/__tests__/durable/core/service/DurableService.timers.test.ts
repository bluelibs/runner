import { initDurableService } from "../../../../durable/core/DurableService";
import type { DurableServiceConfig } from "../../../../durable/core/interfaces/service";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { SpyQueue } from "../../helpers/DurableService.unit.helpers";

type TimerSettings = Pick<DurableServiceConfig, "timers" | "polling">;

describe("durable timer configuration and legacy polling compatibility", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each<{
    name: string;
    settings: TimerSettings;
    interval: number;
    concurrency: number;
    ttl: number;
  }>([
    {
      name: "defaults",
      settings: {},
      interval: 1000,
      concurrency: 10,
      ttl: 30_000,
    },
    {
      name: "legacy polling",
      settings: { polling: { interval: 17, concurrency: 3, claimTtlMs: 70 } },
      interval: 17,
      concurrency: 3,
      ttl: 70,
    },
    {
      name: "preferred timers",
      settings: {
        timers: { pollIntervalMs: 23, concurrency: 4, claimTtlMs: 90 },
      },
      interval: 23,
      concurrency: 4,
      ttl: 90,
    },
    {
      name: "preferred fields override legacy fields",
      settings: {
        timers: {
          enabled: true,
          pollIntervalMs: 29,
          concurrency: 5,
          claimTtlMs: 100,
        },
        polling: {
          enabled: false,
          interval: 2,
          concurrency: 1,
          claimTtlMs: 10,
        },
      },
      interval: 29,
      concurrency: 5,
      ttl: 100,
    },
    {
      name: "omitted fields inherit legacy values",
      settings: {
        timers: { enabled: true },
        polling: {
          enabled: false,
          interval: 31,
          concurrency: 6,
          claimTtlMs: 110,
        },
      },
      interval: 31,
      concurrency: 6,
      ttl: 110,
    },
  ])(
    "applies $name to timer claims and polling cadence",
    async ({ settings, interval, concurrency, ttl }) => {
      const store = new MemoryStore();
      const claim = jest.spyOn(store, "claimReadyTimers");
      const service = await initDurableService({ store, ...settings });
      try {
        await jest.advanceTimersByTimeAsync(0);
        expect(claim).toHaveBeenCalledWith(
          expect.any(Date),
          concurrency,
          expect.any(String),
          ttl,
        );
        const count = claim.mock.calls.length;
        await jest.advanceTimersByTimeAsync(interval - 1);
        expect(claim).toHaveBeenCalledTimes(count);
        await jest.advanceTimersByTimeAsync(1);
        expect(claim).toHaveBeenCalledTimes(count + 1);
      } finally {
        await service.stop();
      }
    },
  );

  it.each<TimerSettings>([
    { timers: { enabled: false } },
    { polling: { enabled: false } },
    { timers: { enabled: false }, polling: { enabled: true } },
    { timers: { concurrency: 2 }, polling: { enabled: false } },
  ])(
    "keeps due timers parked when automatic processing is disabled: %j",
    async (settings) => {
      const store = new MemoryStore();
      await store.createTimer({
        id: "due",
        type: "sleep",
        status: "pending",
        fireAt: new Date(0),
      });
      const claim = jest.spyOn(store, "claimReadyTimers");
      const service = await initDurableService({ store, ...settings });
      try {
        await jest.advanceTimersByTimeAsync(3000);
        expect(claim).not.toHaveBeenCalled();
        expect(await store.getReadyTimers()).toHaveLength(1);
      } finally {
        await service.stop();
      }
    },
  );

  it("retains the queued default claim duration", async () => {
    const store = new MemoryStore();
    const claim = jest.spyOn(store, "claimReadyTimers");
    const service = await initDurableService({
      store,
      queue: new SpyQueue(),
      timers: {},
    });
    try {
      expect(claim).toHaveBeenCalledWith(
        expect.any(Date),
        10,
        expect.any(String),
        5000,
      );
    } finally {
      await service.stop();
    }
  });

  it.each<TimerSettings>([
    { timers: { pollIntervalMs: 0 }, polling: { interval: 10 } },
    { timers: { concurrency: 0 }, polling: { concurrency: 10 } },
    { timers: { claimTtlMs: 0 }, polling: { claimTtlMs: 10 } },
  ])(
    "rejects invalid preferred values instead of falling back: %j",
    async (settings) => {
      await expect(
        initDurableService({ store: new MemoryStore(), ...settings }),
      ).rejects.toThrow("timers.");
    },
  );

  it("allows explicit start after disabling automatic timer processing", async () => {
    const store = new MemoryStore();
    const claim = jest.spyOn(store, "claimReadyTimers");
    const service = await initDurableService({
      store,
      timers: { enabled: false },
    });
    try {
      expect(claim).not.toHaveBeenCalled();
      service.start();
      expect(claim).toHaveBeenCalledTimes(1);
    } finally {
      await service.stop();
    }
  });
});
