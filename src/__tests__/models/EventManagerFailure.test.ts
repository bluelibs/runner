
import { EventManager } from "../../models/EventManager";
import { defineEvent } from "../../define";
import { IEvent } from "../../defs";

describe("EventManager Parallel Failure Behavior", () => {
  let eventManager: EventManager;
  let parallelEvent: IEvent<string>;

  beforeEach(() => {
    eventManager = new EventManager({ runtimeCycleDetection: true });
    parallelEvent = defineEvent<string>({ id: "parallelEvent", parallel: true });
  });

  it("should execute all listeners in a batch even if one fails, but stop before next batch", async () => {
    const results: string[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Batch 0: Listener 1 (Throws immediately)
    eventManager.addListener(
      parallelEvent,
      async () => {
        throw new Error("Fail immediately");
      },
      { order: 0 }
    );

    // Batch 0: Listener 2 (Succeeds after delay)
    eventManager.addListener(
      parallelEvent,
      async () => {
        await delay(50);
        results.push("batch0-slow-success");
      },
      { order: 0 }
    );

    // Batch 1: Listener 3 (Should not run)
    eventManager.addListener(
      parallelEvent,
      async () => {
        results.push("batch1-should-not-run");
      },
      { order: 1 }
    );

    // Expect the emit to throw
    await expect(eventManager.emit(parallelEvent, "data", "test")).rejects.toThrow("Fail immediately");

    // Wait a bit to ensure the slow listener had time to finish (if it was running)
    await delay(100);

    // Verify behavior
    // 1. "batch0-slow-success" SHOULD be in results (it started running)
    // 2. "batch1-should-not-run" SHOULD NOT be in results (stopped at group level)
    expect(results).toContain("batch0-slow-success");
    expect(results).not.toContain("batch1-should-not-run");
  });
});
