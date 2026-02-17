import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { DurableContext } from "../../durable/core/DurableContext";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import { event } from "../../..";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createMessageError } from "../../../errors";

describe("durable: DurableContext audit branches", () => {
  it("note is a no-op when the store does not support audit", async () => {
    const base = new MemoryStore();
    const bus = new MemoryEventBus();

    const storeNoAudit: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
    };

    const ctx = new DurableContext(storeNoAudit, bus, "e1", 1, {
      auditEnabled: true,
    });
    await expect(ctx.note("hello")).resolves.toBeUndefined();

    await expect(ctx.step("s1", async () => "ok")).resolves.toBe("ok");
    await expect(ctx.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);

    expect(await base.getStepResult("e1", "__note:0")).toBeNull();
    expect(await base.listAuditEntries("e1")).toEqual([]);
  });

  it("note is a no-op when audit is disabled", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    await expect(ctx.note("hello")).resolves.toBeUndefined();

    expect(await store.getStepResult("e1", "__note:0")).toBeNull();
    expect(await store.listAuditEntries("e1")).toEqual([]);
  });

  it("audit persistence failures do not break workflow operations", async () => {
    class ThrowingAuditStore extends MemoryStore {
      override async appendAuditEntry(): Promise<void> {
        throw createMessageError("audit-down");
      }
    }

    const store = new ThrowingAuditStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1, { auditEnabled: true });

    await expect(ctx.step("s1", async () => "ok")).resolves.toBe("ok");
    await expect(ctx.note("still ok")).resolves.toBeUndefined();

    const received: string[] = [];
    await bus.subscribe("durable:events", async (evt) => {
      received.push(evt.type);
    });

    const Evt1 = event<{ a: number }>({ id: "evt.1" });
    await expect(ctx.emit(Evt1, { a: 1 })).resolves.toBeUndefined();
    expect(received).toEqual(["evt.1"]);
  });
});
