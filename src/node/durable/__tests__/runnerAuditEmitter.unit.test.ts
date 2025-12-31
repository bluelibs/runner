import { EventManager } from "../../../models/EventManager";
import type { DurableAuditEntry } from "../core/audit";
import { createDurableRunnerAuditEmitter } from "../emitters/runnerAuditEmitter";
import { durableEvents } from "../events";

describe("durable: createDurableRunnerAuditEmitter", () => {
  it("emits durable audit events for each audit entry kind", async () => {
    const eventManager = new EventManager();
    const emitter = createDurableRunnerAuditEmitter({
      eventManager,
      source: "durable.tests",
    });

    const appended: Array<{ entry: DurableAuditEntry; source: string }> = [];
    const statusChanged: Array<
      Extract<DurableAuditEntry, { kind: "execution_status_changed" }>
    > = [];
    const stepCompleted: Array<
      Extract<DurableAuditEntry, { kind: "step_completed" }>
    > = [];
    const sleepScheduled: Array<
      Extract<DurableAuditEntry, { kind: "sleep_scheduled" }>
    > = [];
    const sleepCompleted: Array<
      Extract<DurableAuditEntry, { kind: "sleep_completed" }>
    > = [];
    const signalWaiting: Array<
      Extract<DurableAuditEntry, { kind: "signal_waiting" }>
    > = [];
    const signalDelivered: Array<
      Extract<DurableAuditEntry, { kind: "signal_delivered" }>
    > = [];
    const signalTimedOut: Array<
      Extract<DurableAuditEntry, { kind: "signal_timed_out" }>
    > = [];
    const emitPublished: Array<
      Extract<DurableAuditEntry, { kind: "emit_published" }>
    > = [];
    const noteCreated: Array<Extract<DurableAuditEntry, { kind: "note" }>> = [];

    eventManager.addListener(durableEvents.audit.appended, (event) => {
      appended.push({ entry: event.data.entry, source: event.source });
    });
    eventManager.addListener(durableEvents.execution.statusChanged, (event) => {
      statusChanged.push(event.data);
    });
    eventManager.addListener(durableEvents.step.completed, (event) => {
      stepCompleted.push(event.data);
    });
    eventManager.addListener(durableEvents.sleep.scheduled, (event) => {
      sleepScheduled.push(event.data);
    });
    eventManager.addListener(durableEvents.sleep.completed, (event) => {
      sleepCompleted.push(event.data);
    });
    eventManager.addListener(durableEvents.signal.waiting, (event) => {
      signalWaiting.push(event.data);
    });
    eventManager.addListener(durableEvents.signal.delivered, (event) => {
      signalDelivered.push(event.data);
    });
    eventManager.addListener(durableEvents.signal.timedOut, (event) => {
      signalTimedOut.push(event.data);
    });
    eventManager.addListener(durableEvents.emit.published, (event) => {
      emitPublished.push(event.data);
    });
    eventManager.addListener(durableEvents.note.created, (event) => {
      noteCreated.push(event.data);
    });

    const at = new Date("2025-01-01T00:00:00.000Z");
    const base: Pick<
      DurableAuditEntry,
      "id" | "executionId" | "at" | "attempt" | "taskId"
    > = {
      id: "a1",
      executionId: "e1",
      at,
      attempt: 1,
      taskId: "t1",
    };

    await emitter.emit({
      ...base,
      kind: "execution_status_changed",
      from: null,
      to: "pending",
      reason: "created",
    });
    await emitter.emit({
      ...base,
      kind: "step_completed",
      stepId: "s1",
      durationMs: 10,
      isInternal: false,
    });
    await emitter.emit({
      ...base,
      kind: "sleep_scheduled",
      stepId: "sleep:0",
      timerId: "timer:1",
      durationMs: 5,
      fireAt: new Date(at.getTime() + 5),
    });
    await emitter.emit({
      ...base,
      kind: "sleep_completed",
      stepId: "sleep:0",
      timerId: "timer:1",
    });
    await emitter.emit({
      ...base,
      kind: "signal_waiting",
      stepId: "__signal:paid",
      signalId: "paid",
      reason: "initial",
    });
    await emitter.emit({
      ...base,
      kind: "signal_delivered",
      stepId: "__signal:paid",
      signalId: "paid",
    });
    await emitter.emit({
      ...base,
      kind: "signal_timed_out",
      stepId: "__signal:paid",
      signalId: "paid",
      timerId: "timer:2",
    });
    await emitter.emit({
      ...base,
      kind: "emit_published",
      stepId: "__emit:0",
      eventId: "x.y",
    });
    await emitter.emit({
      ...base,
      kind: "note",
      message: "hello",
      meta: { a: 1 },
    });

    expect(appended).toHaveLength(9);
    expect(appended.every((e) => e.source === "durable.tests")).toBe(true);

    expect(statusChanged).toHaveLength(1);
    expect(stepCompleted).toHaveLength(1);
    expect(sleepScheduled).toHaveLength(1);
    expect(sleepCompleted).toHaveLength(1);
    expect(signalWaiting).toHaveLength(1);
    expect(signalDelivered).toHaveLength(1);
    expect(signalTimedOut).toHaveLength(1);
    expect(emitPublished).toHaveLength(1);
    expect(noteCreated).toHaveLength(1);
  });
});
