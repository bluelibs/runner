import {
  IEvent,
  IEventEmission,
  symbolEvent,
  symbolFilePath,
} from "../../defs";
import { EventManager } from "../../models/EventManager";
import { defineEvent } from "../../define";

describe("EventManager Parallel Execution", () => {
  let eventManager: EventManager;
  let parallelEvent: IEvent<string>;

  beforeEach(() => {
    eventManager = new EventManager({ runtimeCycleDetection: true });
    parallelEvent = defineEvent<string>({ id: "parallelEvent", parallel: true });
  });

  it("should execute listeners with the same order in parallel", async () => {
    const results: string[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    eventManager.addListener(
      parallelEvent,
      async () => {
        await delay(50);
        results.push("slow");
      },
      { order: 1 }
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("fast");
      },
      { order: 1 }
    );

    await eventManager.emit(parallelEvent, "data", "test");

    // "fast" should finish before "slow" even if "slow" was added first
    expect(results).toEqual(["fast", "slow"]);
  });

  it("should execute batches sequentially", async () => {
    const results: string[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Batch 1 (Order 0)
    eventManager.addListener(
      parallelEvent,
      async () => {
        await delay(50);
        results.push("batch1-slow");
      },
      { order: 0 }
    );
    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("batch1-fast");
      },
      { order: 0 }
    );

    // Batch 2 (Order 1)
    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("batch2");
      },
      { order: 1 }
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
      { order: 0 }
    );

    // Batch 2 (Order 1)
    eventManager.addListener(
      parallelEvent,
      () => {
        results.push("batch2");
      },
      { order: 1 }
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
      { order: 0 }
    );

    eventManager.addListener(
      parallelEvent,
      () => {
        results.push("batch1-other");
      },
      { order: 0 }
    );

    await eventManager.emit(parallelEvent, "data", "test");

    // Both should run because they are in the same parallel batch
    expect(results).toContain("batch1-stopper");
    expect(results).toContain("batch1-other");
  });

  it("should handle errors in parallel execution", async () => {
    eventManager.addListener(
      parallelEvent,
      async () => {
        throw new Error("Parallel Error");
      },
      { order: 0 }
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        // This one succeeds
      },
      { order: 0 }
    );

    await expect(
      eventManager.emit(parallelEvent, "data", "test")
    ).rejects.toThrow("Parallel Error");
  });
  it("should skip listener if it is the source of the event", async () => {
    const results: string[] = [];
    const sourceId = "my-source";

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("should-not-run");
      },
      { order: 0, id: sourceId }
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("should-run");
      },
      { order: 0 }
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
        filter: () => false
      }
    );

    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("filtered-in");
      },
      { 
        order: 0,
        filter: () => true
      }
    );

    await eventManager.emit(parallelEvent, "data", "test");

    expect(results).toEqual(["filtered-in"]);
  });
});
