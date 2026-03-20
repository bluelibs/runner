import { defineEvent } from "../../..";
import { DurableService } from "../../durable/core/DurableService";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { signalSetup, Paid } from "./DurableService.signal.test.helpers";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";
import {
  createBareStore,
  sleepingExecution,
} from "./DurableService.unit.helpers";

const TrimmedNote = defineEvent({
  id: "trimmed-note",
  payloadSchema: {
    parse: (input: unknown) => {
      const note = input as { message: string };
      return { message: note.message.trim() };
    },
  },
});

describe("durable: DurableService - signals delivery", () => {
  it("validates and stores transformed signal payloads when a payload schema exists", async () => {
    const { store, service } = await signalSetup({ queue: false });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:trimmed-note",
      result: { state: "waiting", signalId: "trimmed-note" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "trimmed-note",
      stepId: "__signal:trimmed-note",
      sortKey: createSignalWaiterSortKey(
        "trimmed-note",
        "__signal:trimmed-note",
      ),
    });

    await service.signal("e1", TrimmedNote, { message: "  ok  " });

    expect(
      (await store.getStepResult("e1", "__signal:trimmed-note"))?.result,
    ).toEqual({
      state: "completed",
      payload: { message: "ok" },
    });
  });

  it("runs payloadSchema.parse() before storing a signal payload", async () => {
    const { store, service } = await signalSetup({ queue: false });
    const parse = jest.fn((input: unknown) => input as { paidAt: number });
    const ParsedPaid = defineEvent({
      id: "parsed-paid",
      payloadSchema: { parse },
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:parsed-paid",
      result: { state: "waiting", signalId: "parsed-paid" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "parsed-paid",
      stepId: "__signal:parsed-paid",
      sortKey: createSignalWaiterSortKey("parsed-paid", "__signal:parsed-paid"),
    });

    await service.signal("e1", ParsedPaid, { paidAt: 4 });

    expect(parse).toHaveBeenCalledWith({ paidAt: 4 });
  });

  it("signals enqueue resume messages when a queue is configured", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
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

  it("delivers indexed waiters directly without legacy rehydration", async () => {
    const { store, service } = await signalSetup();
    const upsertSpy = jest.spyOn(store, "upsertSignalWaiter");

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await service.signal("e1", Paid, { paidAt: 7 });

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 7 },
    });
  });

  it("buffers waiting signal steps that were persisted without a waiter index", async () => {
    const base = new MemoryStore();
    const store = createBareStore(base);
    const service = new DurableService({
      store,
      tasks: [],
    });

    await base.saveExecution(sleepingExecution());
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 8 });

    expect((await base.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "waiting",
    });
    await expect(base.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 8 } })],
      history: [expect.objectContaining({ payload: { paidAt: 8 } })],
    });
  });

  it("buffers indexed legacy waiters when listStepResults() is unavailable", async () => {
    const base = new MemoryStore();
    const store = createBareStore(base, {
      listStepResults: undefined,
    });
    const service = new DurableService({
      store,
      tasks: [],
    });

    await base.saveExecution(sleepingExecution());
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 9 });

    expect((await base.getStepResult("e1", "__signal:paid:1"))?.result).toEqual(
      { state: "waiting" },
    );
    await expect(base.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 9 } })],
      history: [expect.objectContaining({ payload: { paidAt: 9 } })],
    });
  });

  it("cleans up timers from indexed waiters even when the waiting step omits timerId", async () => {
    const { store, service } = await signalSetup();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
      timerId: "timer-1",
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await store.createTimer({
      id: "timer-1",
      executionId: "e1",
      type: "signal_timeout",
      fireAt: new Date(0),
      status: "pending",
    });

    await service.signal("e1", Paid, { paidAt: 12 });

    expect(await store.getReadyTimers(new Date(Date.now() + 60_000))).toEqual(
      [],
    );
  });

  it("buffers when no indexed waiter exists, even without listStepResults()", async () => {
    const base = new MemoryStore();
    const store = createBareStore(base, {
      listStepResults: undefined,
    });
    const service = new DurableService({
      store,
      tasks: [],
    });

    await base.saveExecution(sleepingExecution());
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "completed" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 13 });

    await expect(base.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 13 } })],
      history: [expect.objectContaining({ payload: { paidAt: 13 } })],
    });
  });

  it("skips unrelated legacy waiters that belong to a different signal", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:other",
      result: { state: "waiting", signalId: "other" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await service.signal("e1", Paid, { paidAt: 10 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 10 },
    });
    expect((await store.getStepResult("e1", "__signal:other"))?.result).toEqual(
      expect.objectContaining({ state: "waiting" }),
    );
  });

  it("queues a signal when no legacy waiters are available and waiter indexing is unsupported", async () => {
    const base = new MemoryStore();
    const store = createBareStore(base);
    const service = new DurableService({
      store,
      tasks: [],
    });

    await base.saveExecution(sleepingExecution());

    await service.signal("e1", Paid, { paidAt: 11 });

    await expect(base.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 11 } })],
      history: [expect.objectContaining({ payload: { paidAt: 11 } })],
    });
  });

  it("delivers indexed signal waiters without scanning step history", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter?.({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    const listStepResults = jest
      .spyOn(store, "listStepResults")
      .mockRejectedValue(new Error("signal() should not scan step history"));

    await service.signal("e1", Paid, { paidAt: 7 });

    expect(listStepResults).not.toHaveBeenCalled();
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 7 },
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

    await base.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
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

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
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

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:stable-paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:stable-paid"),
    });
    await service.signal("e1", Paid, { paidAt: 123 });

    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual({
      state: "completed",
      signalId: "paid",
      payload: { paidAt: 123 },
    });
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

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:stable-paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:stable-paid"),
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

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:2",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:2"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:stable-paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:stable-paid"),
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

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:2",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:2"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:10",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:10"),
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

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:1",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:1"),
      timerId: "signal_timeout:e1:__signal:paid:1",
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:10",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:10"),
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

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:zzz",
      sortKey: createSignalWaiterSortKey("paid", "__signal:zzz"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:aaa",
      sortKey: createSignalWaiterSortKey("paid", "__signal:aaa"),
    });
    await service.signal("e1", Paid, { paidAt: 6 });

    expect((await store.getStepResult("e1", "__signal:aaa"))?.result).toEqual({
      state: "completed",
      signalId: "paid",
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
      stepId: "note:other",
      result: 123,
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
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
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
      timerId: "signal_timeout:e1:__signal:paid",
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

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await service.signal("e1", Paid, { paidAt: 9 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 9 },
    });
  });
});
