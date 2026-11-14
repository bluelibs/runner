import { ClusterRecovery } from "../../../../durable/core/managers/ClusterRecovery";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createBareStore,
  createBufferedLogger,
  pendingExecution,
} from "../../helpers/DurableService.unit.helpers";

describe("continuous cluster recovery", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function harness(options = {}) {
    const store = new MemoryStore();
    const recover = jest.fn(async (_id: string) => {});
    const { logger } = createBufferedLogger();
    const recovery = new ClusterRecovery(
      store,
      { enabled: true, intervalMs: 100, ...options },
      recover,
      (key) => key === "known",
      logger,
    );
    return { store, recover, recovery, logger };
  }

  it("pages metadata fairly, skips live owners and unknown workflows, and retains dispatch claims", async () => {
    const { store, recover, recovery } = harness({ batchSize: 2 });
    for (let i = 0; i < 5; i++)
      await store.saveExecution(
        pendingExecution({
          id: String(i),
          workflowKey: i === 0 ? "unknown" : "known",
          createdAt: new Date(1000 - i),
        }),
      );
    await store.acquireLock("execution:1", 10_000);
    const scan = jest.spyOn(store, "listExecutionStates");
    const all = jest.spyOn(store, "listIncompleteExecutions");
    const timers = jest.spyOn(store, "getReadyTimers");
    recovery.start();
    recovery.start();
    await jest.advanceTimersByTimeAsync(400);
    expect(recover.mock.calls.map(([id]) => id).sort()).toEqual([
      "2",
      "3",
      "4",
    ]);
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, cursor: expect.any(String) }),
    );
    expect(all).not.toHaveBeenCalled();
    expect(timers).not.toHaveBeenCalled();
    expect(await store.acquireLock("recovery:execution:2", 100)).toBeNull();
    recovery.cooldown();
    const count = scan.mock.calls.length;
    await jest.advanceTimersByTimeAsync(500);
    expect(scan).toHaveBeenCalledTimes(count);
    recovery.start();
    await recovery.stop();
  });

  it("bounds concurrent dispatch, resumes mid-page, and drains accepted work on stop", async () => {
    const { store, recover, recovery } = harness({
      concurrency: 1,
      batchSize: 3,
    });
    let finish!: () => void;
    recover.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    for (const id of ["a", "b", "c"])
      await store.saveExecution(pendingExecution({ id, workflowKey: "known" }));
    recovery.start();
    await jest.advanceTimersByTimeAsync(300);
    expect(recover).toHaveBeenCalledTimes(1);
    finish();
    await jest.advanceTimersByTimeAsync(200);
    expect(recover).toHaveBeenCalledTimes(3);
    await recovery.stop();
  });

  it("coordinates sweepers and retries dispatch errors without killing the loop", async () => {
    const { store, recover, recovery, logger } = harness();
    await store.saveExecution(
      pendingExecution({ id: "one", workflowKey: "known" }),
    );
    recover.mockRejectedValueOnce(new Error("broker unavailable"));
    const peer = new ClusterRecovery(
      store,
      { enabled: true, intervalMs: 100 },
      recover,
      () => true,
      logger,
    );
    recovery.start();
    peer.start();
    await jest.advanceTimersByTimeAsync(300);
    expect(recover).toHaveBeenCalledTimes(2);
    await Promise.all([recovery.stop(), peer.stop()]);
  });

  it("survives index/log errors and never overlaps a blocked scan", async () => {
    const { store, recovery, logger } = harness();
    jest.spyOn(logger, "error").mockRejectedValue(new Error("logger offline"));
    const scan = jest
      .spyOn(store, "listExecutionStates")
      .mockRejectedValueOnce(new Error("store offline"));
    recovery.start();
    await jest.advanceTimersByTimeAsync(100);
    let finish!: (rows: []) => void;
    scan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await jest.advanceTimersByTimeAsync(300);
    const count = scan.mock.calls.length;
    await jest.advanceTimersByTimeAsync(300);
    expect(scan).toHaveBeenCalledTimes(count);
    const stopped = recovery.stop();
    finish([]);
    await stopped;
  });

  it("rechecks ownership and execution state after taking a recovery claim", async () => {
    const { store, recover, recovery } = harness();
    await store.saveExecution(
      pendingExecution({ id: "one", workflowKey: "known" }),
    );
    jest
      .spyOn(store, "hasExecutionLease")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    recovery.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(recover).not.toHaveBeenCalled();
    await recovery.stop();
    expect(
      await store.acquireLock("recovery:execution:one", 100),
    ).not.toBeNull();
  });

  it.each(["intervalMs", "batchSize", "concurrency", "claimTtlMs"])(
    "rejects invalid %s",
    (key) => {
      expect(() => harness({ [key]: 0 })).toThrow();
    },
  );

  it("ignores candidates deleted or parked after the metadata page was read", async () => {
    const { store, recover, recovery } = harness();
    for (const id of ["gone", "parked", "changed"])
      await store.saveExecution(pendingExecution({ id, workflowKey: "known" }));
    jest.spyOn(store, "getExecution").mockImplementation(async (id) =>
      id === "gone"
        ? null
        : pendingExecution({
            id,
            workflowKey: id === "changed" ? "unknown" : "known",
            status: "paused",
          }),
    );
    recovery.start();
    await jest.advanceTimersByTimeAsync(100);
    expect(recover).not.toHaveBeenCalled();
    await recovery.stop();
  });

  it("requires explicit capabilities when enabled and remains off by default", async () => {
    expect(() => harness({ batchSize: 1001 })).toThrow();
    const { logger } = createBufferedLogger();
    const store = createBareStore(new MemoryStore());
    expect(
      () =>
        new ClusterRecovery(
          store,
          { enabled: true },
          jest.fn(),
          () => true,
          logger,
        ),
    ).toThrow("atomic execution ownership");
    const scan = jest.spyOn(store, "listIncompleteExecutions");
    const disabled = new ClusterRecovery(
      store,
      undefined,
      jest.fn(),
      () => true,
      logger,
    );
    disabled.start();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(scan).not.toHaveBeenCalled();
    await disabled.stop();
  });
});
