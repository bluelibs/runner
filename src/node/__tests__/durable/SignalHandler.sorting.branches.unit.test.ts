import { event } from "../../..";
import { DurableService } from "../../durable/core/DurableService";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { SpyQueue, sleepingExecution } from "./DurableService.unit.helpers";

const Paid = event<{ paidAt: number }>({ id: "paid" });

describe("durable: SignalHandler sorting branch coverage", () => {
  it("treats non-numeric suffixes as custom slots when ranking waiters", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    await store.saveExecution(sleepingExecution());
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:foo",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:foo"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 1 } });
  });

  it("falls back to lexical ordering when numeric slot indexes are equal", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    await store.saveExecution(sleepingExecution());
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:01",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:01"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });
    expect(
      (await store.getStepResult("e1", "__signal:paid:1"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });
});
