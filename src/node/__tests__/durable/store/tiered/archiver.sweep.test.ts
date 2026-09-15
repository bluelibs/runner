import { startColdStorageSweep } from "../../../../durable/store/tiered/sweeper";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { createStubExecution, createStubStore } from "./stub.helpers";

const OLD = new Date("2024-01-01T00:00:00.000Z");

async function seedOldTerminal(hot: MemoryStore, id: string): Promise<void> {
  await hot.saveExecution(
    createStubExecution({ id, completedAt: OLD, updatedAt: OLD }),
  );
}

describe("durable: startColdStorageSweep", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("rejects invalid intervals", () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();

    for (const intervalMs of [0, -3, 2.5]) {
      expect(() => startColdStorageSweep({ hot, cold, intervalMs })).toThrow(
        `Cold storage sweep interval must be a positive integer of milliseconds. Received: ${intervalMs}.`,
      );
    }
  });

  it("archives on every tick and reports results", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedOldTerminal(hot, "exec-1");
    const onResult = jest.fn();
    const sweep = startColdStorageSweep({
      hot,
      cold,
      intervalMs: 1000,
      onResult,
    });

    await jest.advanceTimersByTimeAsync(1000);

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ archived: ["exec-1"], dryRun: false }),
    );
    await expect(hot.getExecution("exec-1")).resolves.toBeNull();

    await jest.advanceTimersByTimeAsync(1000);
    expect(onResult).toHaveBeenCalledTimes(2);
    sweep.stop();
  });

  it("runs passes on demand and stops the loop", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    await seedOldTerminal(hot, "exec-1");
    const listExecutions = jest.spyOn(hot, "listExecutions");
    const sweep = startColdStorageSweep({ hot, cold, intervalMs: 1000 });

    const result = await sweep.runOnce();
    expect(result.archived).toEqual(["exec-1"]);

    sweep.stop();
    sweep.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(listExecutions).toHaveBeenCalledTimes(1);
  });

  it("reports errors and keeps sweeping", async () => {
    const hot = createStubStore({
      overrides: {
        listExecutions: jest
          .fn()
          .mockRejectedValueOnce(new Error("hot down"))
          .mockResolvedValue([]),
      },
    });
    const onError = jest.fn();
    const sweep = startColdStorageSweep({
      hot,
      cold: new MemoryStore(),
      intervalMs: 1000,
      onError,
    });

    await jest.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    await jest.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    sweep.stop();
  });

  it("survives failing listeners", async () => {
    const hot = new MemoryStore();
    const cold = new MemoryStore();
    const sweep = startColdStorageSweep({
      hot,
      cold,
      intervalMs: 1000,
      onResult: () => {
        throw new Error("listener down");
      },
    });

    await jest.advanceTimersByTimeAsync(2000);
    sweep.stop();
  });

  it("survives failing error listeners", async () => {
    const hot = createStubStore({
      overrides: {
        listExecutions: jest.fn().mockRejectedValue(new Error("hot down")),
      },
    });
    const sweep = startColdStorageSweep({
      hot,
      cold: new MemoryStore(),
      intervalMs: 1000,
      onError: () => {
        throw new Error("listener down");
      },
    });

    await jest.advanceTimersByTimeAsync(2000);
    sweep.stop();
  });

  it("tolerates timer handles without unref", () => {
    const setTimeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((() => ({})) as unknown as typeof setTimeout);

    try {
      const sweep = startColdStorageSweep({
        hot: new MemoryStore(),
        cold: new MemoryStore(),
        intervalMs: 1000,
      });
      sweep.stop();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("does not reschedule after stopping mid-flight", async () => {
    const hot = new MemoryStore();
    await seedOldTerminal(hot, "exec-1");
    let releaseList!: () => void;
    let signalTickStarted!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const tickStarted = new Promise<void>((resolve) => {
      signalTickStarted = resolve;
    });
    const listExecutions = jest
      .spyOn(hot, "listExecutions")
      .mockImplementationOnce(async (...args) => {
        signalTickStarted();
        await listGate;
        return await MemoryStore.prototype.listExecutions.apply(hot, args);
      });
    const sweep = startColdStorageSweep({
      hot,
      cold: new MemoryStore(),
      intervalMs: 1000,
    });

    const tick = jest.advanceTimersByTimeAsync(1000);
    await tickStarted;
    sweep.stop();
    releaseList();
    await tick;
    await jest.advanceTimersByTimeAsync(5000);

    expect(listExecutions).toHaveBeenCalledTimes(1);
  });
});
