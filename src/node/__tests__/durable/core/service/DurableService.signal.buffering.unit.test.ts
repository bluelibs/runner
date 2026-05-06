import {
  signalSetup,
  Paid,
  Timed,
  X,
} from "../../helpers/DurableService.signal.test.helpers";
import { createSignalWaiterSortKey } from "../../../../durable/core/signalWaiters";

describe("durable: DurableService - signals buffering and audit", () => {
  it("signal retains the first payload in history and the queued signal list before the workflow waits", async () => {
    const { store, queue, service } = await signalSetup();

    await service.signal("e1", Paid, { paidAt: 1 });

    expect(await store.getStepResult("e1", "__signal:paid")).toBeNull();
    await expect(store.getSignalState!("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 1 },
        }),
      ],
      history: [expect.objectContaining({ payload: { paidAt: 1 } })],
    });
    expect(queue!.enqueued).toEqual([]);
  });

  it("signal ignores missing and terminal executions", async () => {
    const { store, queue, service } = await signalSetup();

    await expect(service.signal("missing", X, 1)).resolves.toBeUndefined();
    expect(await store.getStepResult("missing", "__signal:x")).toBeNull();
    await expect(store.getSignalState!("missing", "x")).resolves.toBeNull();
    expect(queue!.enqueued.length).toBe(0);

    await store.saveExecution({
      id: "done",
      workflowKey: "t",
      input: undefined,
      status: "completed",
      result: "ok",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "done",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await service.signal("done", X, 1);
    expect((await store.getStepResult("done", "__signal:x"))?.result).toEqual({
      state: "waiting",
    });
    await expect(store.getSignalState!("done", "x")).resolves.toBeNull();

    await store.saveExecution({
      id: "failed",
      workflowKey: "t",
      input: undefined,
      status: "failed",
      error: { message: "err" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "failed",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await service.signal("failed", X, 1);
    expect((await store.getStepResult("failed", "__signal:x"))?.result).toEqual(
      { state: "waiting" },
    );
    await expect(store.getSignalState!("failed", "x")).resolves.toBeNull();

    expect(queue!.enqueued.length).toBe(0);
  });

  it("signal retains duplicate arrivals in history and queues each copy", async () => {
    const { store, queue, service } = await signalSetup();

    await service.signal("e1", Paid, { paidAt: 2 });
    await service.signal("e1", Paid, { paidAt: 2 });

    expect(await store.getStepResult("e1", "__signal:paid")).toBeNull();
    expect(await store.getStepResult("e1", "__signal:paid:1")).toBeNull();
    await expect(store.getSignalState!("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 2 },
        }),
        expect.objectContaining({
          payload: { paidAt: 2 },
        }),
      ],
      history: [
        expect.objectContaining({ payload: { paidAt: 2 } }),
        expect.objectContaining({ payload: { paidAt: 2 } }),
      ],
    });

    expect(await store.consumeQueuedSignalRecord("e1", "paid")).toEqual(
      expect.objectContaining({ payload: { paidAt: 2 } }),
    );
    expect(await store.consumeQueuedSignalRecord("e1", "paid")).toEqual(
      expect.objectContaining({ payload: { paidAt: 2 } }),
    );
    expect(queue!.enqueued.length).toBe(0);
  });

  it("signal does not overwrite completed or timed out signal steps", async () => {
    const { store, service } = await signalSetup({ queue: false });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed" },
      completedAt: new Date(),
    });
    await service.signal("e1", Paid, { paidAt: 123 });
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
    });
    await expect(store.getSignalState!("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 123 },
        }),
      ],
      history: [expect.objectContaining({ payload: { paidAt: 123 } })],
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:timed",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });
    await service.signal("e1", Timed, { paidAt: 123 });
    expect((await store.getStepResult("e1", "__signal:timed"))?.result).toEqual(
      { state: "timed_out" },
    );
    await expect(store.getSignalState!("e1", "timed")).resolves.toEqual({
      executionId: "e1",
      signalId: "timed",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 123 },
        }),
      ],
      history: [expect.objectContaining({ payload: { paidAt: 123 } })],
    });
  });

  it("signal completes indexed waits and deletes any timeout timer", async () => {
    const { store, queue, service } = await signalSetup();
    await store.updateExecution("e1", {
      current: {
        kind: "waitForSignal",
        stepId: "__signal:paid:1",
        startedAt: new Date(),
        waitingFor: {
          type: "signal",
          params: {
            signalId: "paid",
            timerId: "t1",
          },
        },
      },
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });

    await store.createTimer({
      id: "t1",
      executionId: "e1",
      stepId: "__signal:paid:1",
      type: "signal_timeout",
      fireAt: new Date(Date.now() + 1000),
      status: "pending",
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting", timerId: "t1" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:1",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:1"),
      timerId: "t1",
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:1"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });
    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers.some((t) => t.id === "t1")).toBe(false);
    expect((await store.getExecution("e1"))?.current).toBeUndefined();
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("signal buffers indexed waits without a timeout timer when no waiter index exists", async () => {
    const { base, queue, service } = await signalSetup({
      storeOverrides: {
        claimTimer: undefined,
      },
    });

    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect((await base.getStepResult("e1", "__signal:paid:1"))?.result).toEqual(
      { state: "waiting" },
    );
    expect(queue!.enqueued).toEqual([]);
    await expect(base.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 2 } })],
      history: [expect.objectContaining({ payload: { paidAt: 2 } })],
    });
  });
});
