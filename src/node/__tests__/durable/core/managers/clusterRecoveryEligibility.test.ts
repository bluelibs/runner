import { needsClusterRecovery } from "../../../../durable/core/managers/clusterRecoveryEligibility";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import {
  createExecutionWaitCurrent,
  createSignalWaitCurrent,
  createSleepCurrent,
} from "../../../../durable/core/current";
import type { Execution, Timer } from "../../../../durable/core/types";
import { pendingExecution } from "../../helpers/DurableService.unit.helpers";

describe("cluster recovery eligibility", () => {
  const now = new Date();
  const timer: Timer = {
    id: "timer",
    executionId: "one",
    stepId: "wait",
    type: "sleep",
    status: "pending",
    fireAt: now,
  };
  let store: MemoryStore;
  let execution: Execution;
  beforeEach(() => {
    store = new MemoryStore();
    execution = pendingExecution({ id: "one", status: "sleeping" });
  });
  const ready = () => needsClusterRecovery(store, execution);
  async function step(result: unknown) {
    await store.saveStepResult({
      executionId: "one",
      stepId: "wait",
      result,
      completedAt: now,
    });
  }

  it.each([
    "paused",
    "completed",
    "failed",
    "cancelled",
    "continued_as_new",
    "compensation_failed",
  ] as const)("skips %s", async (status) => {
    execution.status = status;
    expect(await ready()).toBe(false);
  });
  it("reconciles cancellations and interrupted transitions", async () => {
    execution.status = "cancelling";
    expect(await ready()).toBe(true);
    execution.status = "pending";
    expect(await ready()).toBe(true);
    execution.status = "sleeping";
    expect(await ready()).toBe(true);
    execution.current = { kind: "step", stepId: "wait", startedAt: now };
    expect(await ready()).toBe(true);
    await store.createTimer({ ...timer, type: "retry" });
    expect(await ready()).toBe(false);
  });
  it("leaves healthy sleeps to the poller and repairs missing timers", async () => {
    execution.current = createSleepCurrent({
      stepId: "wait",
      timerId: "timer",
      fireAtMs: now.getTime(),
      startedAt: now,
    });
    expect(await ready()).toBe(true);
    await store.createTimer({ ...timer, stepId: "other" });
    expect(await ready()).toBe(true);
    await store.createTimer(timer);
    expect(await ready()).toBe(false);
    await step({ state: "completed" });
    expect(await ready()).toBe(true);
  });
  it("leaves indefinite signal waits parked, but recovers buffered signals and missing timeouts", async () => {
    execution.current = createSignalWaitCurrent({
      stepId: "wait",
      signalId: "paid",
      startedAt: now,
    });
    expect(await ready()).toBe(true);
    await step({ state: "waiting", signalId: "paid" });
    expect(await ready()).toBe(false);
    await store.bufferSignalRecord("one", "paid", {
      id: "record",
      receivedAt: now,
      payload: true,
    });
    expect(await ready()).toBe(true);
    await store.consumeQueuedSignalRecord("one", "paid");
    expect(await ready()).toBe(false);
    await step({
      state: "waiting",
      signalId: "paid",
      timeoutMs: 100,
      timerId: "timer",
    });
    expect(await ready()).toBe(true);
    await store.createTimer({ ...timer, type: "signal_timeout" });
    expect(await ready()).toBe(false);
    await step({ state: "completed", signalId: "paid" });
    expect(await ready()).toBe(true);
  });
  it("repairs lost child wakeups and follows continuations without replaying healthy waits", async () => {
    execution.current = createExecutionWaitCurrent({
      stepId: "wait",
      targetExecutionId: "child",
      targetWorkflowKey: "child",
      startedAt: now,
    });
    expect(await ready()).toBe(true);
    await step({ state: "waiting", targetExecutionId: "child" });
    expect(await ready()).toBe(true);
    await store.saveExecution(pendingExecution({ id: "child" }));
    expect(await ready()).toBe(false);
    await store.updateExecution("child", {
      status: "continued_as_new",
      continuedAsExecutionId: "tip",
    });
    await store.saveExecution(pendingExecution({ id: "tip" }));
    expect(await ready()).toBe(false);
    await step({
      state: "waiting",
      targetExecutionId: "child",
      timeoutMs: 100,
      timerId: "timer",
      timeoutAtMs: now.getTime(),
    });
    expect(await ready()).toBe(true);
    await store.createTimer({ ...timer, type: "timeout" });
    expect(await ready()).toBe(false);
    await store.updateExecution("tip", { status: "completed" });
    expect(await ready()).toBe(true);
    await step({ state: "timed_out", targetExecutionId: "child" });
    expect(await ready()).toBe(true);
  });
});
