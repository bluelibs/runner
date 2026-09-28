import { createSignalWaiterSortKey } from "../../../../durable/core/signalWaiters";
import { AuditLogger } from "../../../../durable/core/managers/AuditLogger";
import { SignalHandler } from "../../../../durable/core/managers/SignalHandler";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  Paid,
  signalSetup,
} from "../../helpers/DurableService.signal.test.helpers";
import { sleepingExecution } from "../../helpers/DurableService.unit.helpers";

function continuedExecution(id: string, next?: string): Execution {
  return {
    ...sleepingExecution({ id }),
    status: ExecutionStatus.ContinuedAsNew,
    continuedAsExecutionId: next,
  };
}

async function seedSignalWaiter(
  store: MemoryStore,
  executionId: string,
): Promise<void> {
  await store.saveStepResult({
    executionId,
    stepId: "__signal:paid",
    result: { state: "waiting", signalId: "paid" },
    completedAt: new Date(),
  });
  await store.upsertSignalWaiter({
    executionId,
    signalId: "paid",
    stepId: "__signal:paid",
    sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
  });
}

describe("durable: SignalHandler continuation", () => {
  it("delivers signals addressed to a continued run on the live tip", async () => {
    const { base, queue, service } = await signalSetup({
      executionId: "root",
      executionOverrides: {
        status: ExecutionStatus.ContinuedAsNew,
        continuedAsExecutionId: "tip",
      },
    });
    await base.saveExecution(sleepingExecution({ id: "tip" }));
    await seedSignalWaiter(base, "tip");

    await service.signal("root", Paid, { paidAt: 1 });

    expect((await base.getStepResult("tip", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect(await base.peekNextSignalWaiter("tip", "paid")).toBeNull();
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "tip" } },
    ]);
  });

  it("buffers on the tip when no waiter is registered there", async () => {
    const { base, service } = await signalSetup({
      executionId: "root",
      executionOverrides: {
        status: ExecutionStatus.ContinuedAsNew,
        continuedAsExecutionId: "tip",
      },
    });
    await base.saveExecution(sleepingExecution({ id: "tip" }));

    await service.signal("root", Paid, { paidAt: 2 });

    expect(await base.getSignalState("tip", "paid")).toEqual(
      expect.objectContaining({
        history: [expect.objectContaining({ payload: { paidAt: 2 } })],
      }),
    );
    expect(await base.getSignalState("root", "paid")).toBeNull();
  });

  it("fails fast on a cyclic continuation chain", async () => {
    const { service } = await signalSetup({
      executionId: "root",
      executionOverrides: {
        status: ExecutionStatus.ContinuedAsNew,
        continuedAsExecutionId: "root",
      },
    });

    await expect(service.signal("root", Paid, { paidAt: 1 })).rejects.toThrow(
      "Continuation chain for execution 'root' is cyclic at 'root'.",
    );
  });

  it("drops signals quietly when the chain link is broken", async () => {
    const { base, queue, service } = await signalSetup({
      executionId: "root",
      executionOverrides: { status: ExecutionStatus.ContinuedAsNew },
    });

    await service.signal("root", Paid, { paidAt: 1 });

    expect(queue!.enqueued).toEqual([]);
    expect(await base.getSignalState("root", "paid")).toBeNull();
  });

  it("drops signals quietly when the successor record is missing", async () => {
    const { queue, service } = await signalSetup({
      executionId: "root",
      executionOverrides: {
        status: ExecutionStatus.ContinuedAsNew,
        continuedAsExecutionId: "ghost",
      },
    });

    await service.signal("root", Paid, { paidAt: 1 });

    expect(queue!.enqueued).toEqual([]);
  });

  it("drops signals quietly when a later hop link is broken", async () => {
    const { base, queue, service } = await signalSetup({
      executionId: "root",
      executionOverrides: {
        status: ExecutionStatus.ContinuedAsNew,
        continuedAsExecutionId: "middle",
      },
    });
    await base.saveExecution(continuedExecution("middle", undefined));

    await service.signal("root", Paid, { paidAt: 1 });

    expect(queue!.enqueued).toEqual([]);
    expect(await base.getSignalState("middle", "paid")).toBeNull();
  });

  it("follows multi-hop chains to the live tip", async () => {
    const { base, queue, service } = await signalSetup({
      executionId: "root",
      executionOverrides: {
        status: ExecutionStatus.ContinuedAsNew,
        continuedAsExecutionId: "middle",
      },
    });
    await base.saveExecution(continuedExecution("middle", "tip"));
    await base.saveExecution(sleepingExecution({ id: "tip" }));
    await seedSignalWaiter(base, "tip");

    await service.signal("root", Paid, { paidAt: 7 });

    expect((await base.getStepResult("tip", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 7 },
    });
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "tip" } },
    ]);
  });

  it("warns when dropping a signal on a link-less continuation", async () => {
    const store = new MemoryStore();
    await store.saveExecution(continuedExecution("root", undefined));
    const warn = jest.fn().mockResolvedValue(undefined);
    const handler = new SignalHandler(
      store,
      new AuditLogger({ enabled: false }, store),
      { warn } as any,
      undefined,
      3,
      { processExecution: async () => {}, resolveTask: () => undefined },
    );

    await handler.signal("root", Paid, { paidAt: 1 });

    expect(warn).toHaveBeenCalledWith(
      "Durable signal dropped: continuation chain is broken.",
      expect.objectContaining({
        executionId: "root",
        tipExecutionId: "root",
        reason: "continued_as_new without a successor link",
      }),
    );
  });

  it("warns when dropping a signal on a missing successor", async () => {
    const store = new MemoryStore();
    await store.saveExecution(continuedExecution("root", "ghost"));
    const warn = jest.fn().mockResolvedValue(undefined);
    const handler = new SignalHandler(
      store,
      new AuditLogger({ enabled: false }, store),
      { warn } as any,
      undefined,
      3,
      { processExecution: async () => {}, resolveTask: () => undefined },
    );

    await handler.signal("root", Paid, { paidAt: 1 });

    expect(warn).toHaveBeenCalledWith(
      "Durable signal dropped: continuation chain is broken.",
      expect.objectContaining({
        executionId: "root",
        tipExecutionId: "ghost",
        reason: "successor record is missing",
      }),
    );
  });

  it("stays silent when the signaled execution itself is missing", async () => {
    const store = new MemoryStore();
    const warn = jest.fn().mockResolvedValue(undefined);
    const handler = new SignalHandler(
      store,
      new AuditLogger({ enabled: false }, store),
      { warn } as any,
      undefined,
      3,
      { processExecution: async () => {}, resolveTask: () => undefined },
    );

    await handler.signal("missing", Paid, { paidAt: 1 });

    expect(warn).not.toHaveBeenCalled();
  });
});
