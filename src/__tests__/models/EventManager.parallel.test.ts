import { EventEmissionFailureMode, IEvent } from "../../defs";
import { EventManager } from "../../models/EventManager";
import { defineEvent } from "../../define";
import { createMessageError } from "../../errors";

describe("EventManager Parallel Execution", () => {
  let eventManager: EventManager;
  let parallelEvent: IEvent<string>;

  beforeEach(() => {
    eventManager = new EventManager({ runtimeEventCycleDetection: true });
    parallelEvent = defineEvent<string>({
      id: "parallelEvent",
      parallel: true,
    });
  });

  it("should execute listeners with the same order in parallel", async () => {
    const results: string[] = [];
    const nextTick = async () => Promise.resolve();

    eventManager.addListener(
      parallelEvent,
      async () => {
        await nextTick();
        results.push("slow");
      },
      { order: 1 },
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("fast");
      },
      { order: 1 },
    );

    await eventManager.emit(parallelEvent, "data", "test");

    // "fast" should finish before "slow" even if "slow" was added first
    expect(results).toEqual(["fast", "slow"]);
  });

  it("should execute batches sequentially", async () => {
    const results: string[] = [];
    const nextTick = async () => Promise.resolve();

    // Batch 1 (Order 0)
    eventManager.addListener(
      parallelEvent,
      async () => {
        await nextTick();
        results.push("batch1-slow");
      },
      { order: 0 },
    );
    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("batch1-fast");
      },
      { order: 0 },
    );

    // Batch 2 (Order 1)
    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("batch2");
      },
      { order: 1 },
    );

    await eventManager.emit(parallelEvent, "data", "test");

    // Batch 1 should finish completely before Batch 2 starts
    // Inside Batch 1, "fast" finishes before "slow"
    expect(results).toEqual(["batch1-fast", "batch1-slow", "batch2"]);
  });

  it("should stop propagation between batches", async () => {
    const results: string[] = [];

    // Batch 1 (Order 0)
    eventManager.addListener(
      parallelEvent,
      (event) => {
        results.push("batch1");
        event.stopPropagation();
      },
      { order: 0 },
    );

    // Batch 2 (Order 1)
    eventManager.addListener(
      parallelEvent,
      () => {
        results.push("batch2");
      },
      { order: 1 },
    );

    await eventManager.emit(parallelEvent, "data", "test");

    expect(results).toEqual(["batch1"]);
  });

  it("should NOT stop propagation within the same batch", async () => {
    const results: string[] = [];

    // Batch 1 (Order 0)
    eventManager.addListener(
      parallelEvent,
      (event) => {
        results.push("batch1-stopper");
        event.stopPropagation();
      },
      { order: 0 },
    );

    eventManager.addListener(
      parallelEvent,
      () => {
        results.push("batch1-other");
      },
      { order: 0 },
    );

    await eventManager.emit(parallelEvent, "data", "test");

    // Both should run because they are in the same parallel batch
    expect(results).toContain("batch1-stopper");
    expect(results).toContain("batch1-other");
  });

  it("should skip all listeners when propagation is stopped by an interceptor", async () => {
    const results: string[] = [];

    eventManager.intercept(async (next, event) => {
      event.stopPropagation();
      await next(event);
    });

    eventManager.addListener(
      parallelEvent,
      () => {
        results.push("should-not-run");
      },
      { order: 0 },
    );

    eventManager.addListener(
      parallelEvent,
      () => {
        results.push("should-not-run-either");
      },
      { order: 1 },
    );

    await eventManager.emit(parallelEvent, "data", "test");

    expect(results).toEqual([]);
  });

  it("should handle single error in parallel execution", async () => {
    eventManager.addListener(
      parallelEvent,
      async () => {
        throw createMessageError("Parallel Error");
      },
      { order: 0 },
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        // This one succeeds
      },
      { order: 0 },
    );

    await expect(
      eventManager.emit(parallelEvent, "data", "test"),
    ).rejects.toThrow("Parallel Error");
  });

  it("should aggregate multiple errors in the same batch", async () => {
    expect.assertions(4);
    eventManager.addListener(
      parallelEvent,
      async () => {
        throw createMessageError("Error 1");
      },
      { order: 0 },
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        throw createMessageError("Error 2");
      },
      { order: 0 },
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        throw createMessageError("Error 3");
      },
      { order: 0 },
    );

    try {
      await eventManager.emit(parallelEvent, "data", "test");
      fail("Should have thrown");
    } catch (err: any) {
      expect(err.name).toBe("AggregateError");
      expect(err.message).toBe("3 listeners failed in parallel batch");
      expect(err.errors).toHaveLength(3);
      expect(err.errors.map((e: Error) => e.message)).toEqual(
        expect.arrayContaining(["Error 1", "Error 2", "Error 3"]),
      );
    }
  });

  it("should skip listener if it is the source of the event", async () => {
    const results: string[] = [];
    const sourceId = "my-source";

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("should-not-run");
      },
      { order: 0, id: sourceId },
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("should-run");
      },
      { order: 0 },
    );

    await eventManager.emit(parallelEvent, "data", sourceId);

    expect(results).toEqual(["should-run"]);
  });

  it("should respect filters in parallel execution", async () => {
    const results: string[] = [];

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("filtered-out");
      },
      {
        order: 0,
        filter: () => false,
      },
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("filtered-in");
      },
      {
        order: 0,
        filter: () => true,
      },
    );

    await eventManager.emit(parallelEvent, "data", "test");

    expect(results).toEqual(["filtered-in"]);
  });

  it("should handle empty listeners array gracefully", async () => {
    // Create a new event with no listeners
    const emptyEvent = defineEvent<string>({
      id: "emptyParallelEvent",
      parallel: true,
    });

    // Should not throw
    await expect(
      eventManager.emit(emptyEvent, "data", "test"),
    ).resolves.toBeUndefined();
  });

  it("should handle single listener without batching overhead", async () => {
    const results: string[] = [];

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("single");
      },
      { order: 0 },
    );

    await eventManager.emit(parallelEvent, "data", "test");

    expect(results).toEqual(["single"]);
  });

  it("should handle all listeners with different orders (effectively sequential)", async () => {
    const results: string[] = [];

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("order-0");
      },
      { order: 0 },
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("order-1");
      },
      { order: 1 },
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("order-2");
      },
      { order: 2 },
    );

    await eventManager.emit(parallelEvent, "data", "test");

    // Should execute in order since each is in its own batch
    expect(results).toEqual(["order-0", "order-1", "order-2"]);
  });

  it("should stop subsequent batches when error occurs in a batch", async () => {
    const results: string[] = [];

    // Batch 0 - will throw
    eventManager.addListener(
      parallelEvent,
      async () => {
        throw createMessageError("Batch 0 error");
      },
      { order: 0 },
    );

    // Batch 1 - should not run
    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("batch1-should-not-run");
      },
      { order: 1 },
    );

    await expect(
      eventManager.emit(parallelEvent, "data", "test"),
    ).rejects.toThrow("Batch 0 error");

    expect(results).not.toContain("batch1-should-not-run");
  });

  it("aggregate mode should continue later batches and report all failures", async () => {
    const results: string[] = [];

    eventManager.addListener(
      parallelEvent,
      async () => {
        throw createMessageError("batch0-fail");
      },
      { order: 0, id: "b0" },
    );
    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("batch1-ran");
        throw createMessageError("batch1-fail");
      },
      { order: 1, id: "b1" },
    );
    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("batch2-ran");
      },
      { order: 2, id: "b2" },
    );

    const report = await eventManager.emit(parallelEvent, "data", "test", {
      report: true,
      throwOnError: false,
      failureMode: EventEmissionFailureMode.Aggregate,
    });

    expect(results).toEqual(["batch1-ran", "batch2-ran"]);
    expect(report.failedListeners).toBe(2);
    expect(report.errors).toHaveLength(2);
    expect(report.errors.map((error) => error.listenerId)).toEqual([
      "b0",
      "b1",
    ]);
  });
});
