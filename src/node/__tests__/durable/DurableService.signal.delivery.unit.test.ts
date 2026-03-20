import { signalSetup, Paid } from "./DurableService.signal.test.helpers";

describe("durable: DurableService - signals delivery", () => {
  it("signals enqueue resume messages when a queue is configured", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
  });

  it("signals work without listStepResults() support (fallback scan path)", async () => {
    const { base, queue, service } = await signalSetup({
      storeOverrides: {
        listStepResults: undefined,
      },
    });

    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 42 });

    expect((await base.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 42 },
    });
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("accepts typed signal ids in signal()", async () => {
    const { store, service } = await signalSetup({ queue: false });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
  });

  it("delivers signals to waiting steps created with explicit step ids", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 123 });

    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 123 } });
    expect(await store.getStepResult("e1", "__signal:paid")).toBeNull();
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("prefers the base signal slot over custom step id waiters", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("prefers numeric slots over custom step id waiters when no base slot is waiting", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:2",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:2"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });
    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("orders numeric signal slots by ascending index", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:10",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:2",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:2"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });
    expect(
      (await store.getStepResult("e1", "__signal:paid:10"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("keeps the current best waiter when later numeric slots are worse", async () => {
    const { store, service } = await signalSetup();

    await store.createTimer({
      id: "signal_timeout:e1:__signal:paid:1",
      executionId: "e1",
      stepId: "__signal:paid:1",
      type: "signal_timeout",
      fireAt: new Date(0),
      status: "pending",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: {
        state: "waiting",
        signalId: "paid",
        timerId: "signal_timeout:e1:__signal:paid:1",
      },
      completedAt: new Date(1),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:10",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(2),
    });

    await service.signal("e1", Paid, { paidAt: 101 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:1"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 101 } });
    expect(
      (await store.getStepResult("e1", "__signal:paid:10"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("orders custom signal slots deterministically when no numeric slots exist", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:bbb",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:aaa",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 6 });

    expect((await store.getStepResult("e1", "__signal:aaa"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 6 },
    });
    expect((await store.getStepResult("e1", "__signal:bbb"))?.result).toEqual(
      expect.objectContaining({ state: "waiting" }),
    );
  });

  it("ignores unrelated non-record signal steps when listing waiters", async () => {
    const { store, service } = await signalSetup({ queue: false });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:other",
      result: 123,
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 6 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 6 },
    });
  });

  it("cleans up signal timeout timers when delivering a waiting signal", async () => {
    const { store, service } = await signalSetup();

    await store.createTimer({
      id: "signal_timeout:e1:__signal:paid",
      executionId: "e1",
      stepId: "__signal:paid",
      type: "signal_timeout",
      fireAt: new Date(0),
      status: "pending",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: {
        state: "waiting",
        signalId: "paid",
        timerId: "signal_timeout:e1:__signal:paid",
      },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 3 });

    const timers = await store.getReadyTimers(new Date(0));
    expect(timers.some((t) => t.id === "signal_timeout:e1:__signal:paid")).toBe(
      false,
    );
  });

  it("ignores waiting signal steps with invalid timerId types", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid", timerId: 123 },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 9 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 9 },
    });
  });
});
