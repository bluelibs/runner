import { createSignalWaiterSortKey } from "../../../../durable/core/signalWaiters";
import { ExecutionStatus } from "../../../../durable/core/types";
import type { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  Paid,
  signalSetup,
} from "../../helpers/DurableService.signal.test.helpers";
import { sleepingExecution } from "../../helpers/DurableService.unit.helpers";

/**
 * Commits `root -> tip` right before the first buffer lands on `root`, i.e.
 * after signal delivery already decided `root` was the live target.
 */
function continueBeforeFirstRootBuffer(
  ref: { base?: MemoryStore },
  options: { dropBuffer?: boolean } = {},
) {
  let continued = false;
  return {
    bufferSignalRecord: async (
      ...args: Parameters<MemoryStore["bufferSignalRecord"]>
    ) => {
      const base = ref.base!;
      if (!continued && args[0] === "root") {
        continued = true;
        const root = (await base.getExecution("root"))!;
        await base.createContinuedExecution({
          priorExecution: {
            ...root,
            status: ExecutionStatus.ContinuedAsNew,
            continuedAsExecutionId: "tip",
          },
          successorExecution: sleepingExecution({
            id: "tip",
            continuedFromExecutionId: "root",
          }),
        });
      }
      if (options.dropBuffer) return;
      return base.bufferSignalRecord(...args);
    },
  };
}

describe("durable: SignalHandler vs concurrent continuation", () => {
  it("moves a record buffered on a just-continued run to the successor", async () => {
    const ref: { base?: MemoryStore } = {};
    const setup = await signalSetup({
      executionId: "root",
      executionOverrides: { status: ExecutionStatus.Running },
      storeOverrides: continueBeforeFirstRootBuffer(ref),
    });
    const base = (ref.base = setup.base);

    await setup.service.signal("root", Paid, { paidAt: 1 });

    expect((await base.getSignalState("root", "paid"))?.queued).toEqual([]);
    expect((await base.getSignalState("tip", "paid"))?.queued).toEqual([
      expect.objectContaining({ payload: { paidAt: 1 } }),
    ]);
  });

  it("delivers the stranded record to a waiter already parked on the successor", async () => {
    const ref: { base?: MemoryStore } = {};
    const setup = await signalSetup({
      executionId: "root",
      executionOverrides: { status: ExecutionStatus.Running },
      storeOverrides: continueBeforeFirstRootBuffer(ref),
    });
    const base = (ref.base = setup.base);
    // The successor may already be waiting by the time the drain runs.
    const originalCreate = base.createContinuedExecution.bind(base);
    jest
      .spyOn(base, "createContinuedExecution")
      .mockImplementation(async (params) => {
        const committed = await originalCreate(params);
        await base.saveStepResult({
          executionId: "tip",
          stepId: "__signal:paid",
          result: { state: "waiting", signalId: "paid" },
          completedAt: new Date(),
        });
        await base.upsertSignalWaiter({
          executionId: "tip",
          signalId: "paid",
          stepId: "__signal:paid",
          sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
        });
        return committed;
      });

    await setup.service.signal("root", Paid, { paidAt: 7 });

    expect((await base.getStepResult("tip", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 7 },
    });
    expect((await base.getSignalState("root", "paid"))?.queued).toEqual([]);
    expect(setup.queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "tip" } },
    ]);
  });

  it("has nothing to hand over when the closed run kept no backlog", async () => {
    const ref: { base?: MemoryStore } = {};
    const setup = await signalSetup({
      executionId: "root",
      executionOverrides: { status: ExecutionStatus.Running },
      storeOverrides: continueBeforeFirstRootBuffer(ref, { dropBuffer: true }),
    });
    const base = (ref.base = setup.base);

    await setup.service.signal("root", Paid, { paidAt: 3 });

    expect(await base.getSignalState("root", "paid")).toBeNull();
    expect(await base.getSignalState("tip", "paid")).toBeNull();
  });
});
