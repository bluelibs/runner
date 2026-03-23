import {
  clearExecutionCurrent,
  clearExecutionCurrentIfSuspendedOnStep,
  createExecutionWaitCurrent,
  createSignalWaitCurrent,
  createSleepCurrent,
  createStepCurrent,
  createSwitchCurrent,
  createWorkflowStepCurrent,
  setExecutionCurrent,
} from "../../durable/core/current";
import {
  DurableExecutionError,
  parseExecutionWaitState,
  parseSignalState,
  shouldPersistStableSignalId,
} from "../../durable/core/utils";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: current helpers", () => {
  it("preserves explicit startedAt values across helper factories", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");

    expect(
      createStepCurrent({
        stepId: "step-plain",
        startedAt,
      }),
    ).toMatchObject({
      kind: "step",
      stepId: "step-plain",
      startedAt,
    });

    expect(
      createWorkflowStepCurrent({
        stepId: "step-1",
        startedAt,
        meta: { childWorkflowKey: "canonical.child" },
      }),
    ).toMatchObject({
      kind: "step",
      stepId: "step-1",
      startedAt,
      meta: { childWorkflowKey: "canonical.child" },
    });

    expect(
      createSwitchCurrent({
        stepId: "switch-1",
        startedAt,
      }),
    ).toMatchObject({
      kind: "switch",
      stepId: "switch-1",
      startedAt,
    });

    expect(
      createSleepCurrent({
        stepId: "__sleep:stable",
        durationMs: 1000,
        fireAtMs: 2000,
        timerId: "sleep:e1:stable",
        startedAt,
      }),
    ).toMatchObject({
      kind: "sleep",
      startedAt,
      waitingFor: { type: "sleep" },
    });

    expect(
      createSleepCurrent({
        stepId: "__sleep:plain",
        fireAtMs: 3000,
        timerId: "sleep:e1:plain",
        startedAt,
      }),
    ).toMatchObject({
      kind: "sleep",
      startedAt,
      waitingFor: {
        type: "sleep",
        params: { fireAtMs: 3000, timerId: "sleep:e1:plain" },
      },
    });

    expect(
      createSignalWaitCurrent({
        stepId: "__signal:paid",
        signalId: "paid",
        timeoutMs: 500,
        timerId: "signal_timeout:e1:paid",
        startedAt,
      }),
    ).toMatchObject({
      kind: "waitForSignal",
      startedAt,
      waitingFor: { type: "signal" },
    });

    expect(
      createSignalWaitCurrent({
        stepId: "__signal:plain",
        signalId: "plain",
        startedAt,
      }),
    ).toMatchObject({
      kind: "waitForSignal",
      startedAt,
      waitingFor: {
        type: "signal",
        params: { signalId: "plain" },
      },
    });

    expect(
      createExecutionWaitCurrent({
        stepId: "__execution:child",
        targetExecutionId: "child",
        targetWorkflowKey: "canonical.child",
        timeoutMs: 500,
        timerId: "execution_timeout:e1:child",
        startedAt,
      }),
    ).toMatchObject({
      kind: "waitForExecution",
      startedAt,
      waitingFor: { type: "execution" },
    });

    expect(
      createExecutionWaitCurrent({
        stepId: "__execution:plain",
        targetExecutionId: "plain-child",
        targetWorkflowKey: "canonical.plain-child",
        startedAt,
      }),
    ).toMatchObject({
      kind: "waitForExecution",
      startedAt,
      waitingFor: {
        type: "execution",
        params: {
          targetExecutionId: "plain-child",
          targetWorkflowKey: "canonical.plain-child",
        },
      },
    });
  });

  it("ignores missing and terminal executions when updating current", async () => {
    const store = new MemoryStore();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");

    await expect(
      setExecutionCurrent(
        store,
        "missing",
        createStepCurrent({ stepId: "s1", startedAt }),
      ),
    ).resolves.toBeUndefined();

    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    await setExecutionCurrent(
      store,
      "e1",
      createStepCurrent({ stepId: "s1", startedAt }),
    );

    expect((await store.getExecution("e1"))?.current).toBeUndefined();
  });

  it("persists current for active executions and ignores every terminal status", async () => {
    const store = new MemoryStore();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");

    await store.saveExecution({
      id: "running",
      workflowKey: "t",
      input: undefined,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await setExecutionCurrent(
      store,
      "running",
      createSignalWaitCurrent({
        stepId: "__signal:paid",
        signalId: "paid",
        startedAt,
      }),
    );

    expect((await store.getExecution("running"))?.current).toMatchObject({
      kind: "waitForSignal",
      stepId: "__signal:paid",
    });

    for (const status of [
      "failed",
      "cancelled",
      "compensation_failed",
    ] as const) {
      await store.saveExecution({
        id: status,
        workflowKey: "t",
        input: undefined,
        status,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      });

      await setExecutionCurrent(
        store,
        status,
        createStepCurrent({ stepId: `${status}-step`, startedAt }),
      );

      expect((await store.getExecution(status))?.current).toBeUndefined();
    }
  });

  it("clears current for active non-terminal executions only", async () => {
    const store = new MemoryStore();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");

    await expect(
      clearExecutionCurrent(store, "missing"),
    ).resolves.toBeUndefined();

    await store.saveExecution({
      id: "running",
      workflowKey: "t",
      input: undefined,
      status: "running",
      current: createSwitchCurrent({ stepId: "route", startedAt }),
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await clearExecutionCurrent(store, "running");
    expect((await store.getExecution("running"))?.current).toBeUndefined();

    await store.saveExecution({
      id: "terminal",
      workflowKey: "t",
      input: undefined,
      status: "completed",
      current: createStepCurrent({ stepId: "done", startedAt }),
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    await clearExecutionCurrent(store, "terminal");
    expect((await store.getExecution("terminal"))?.current).toMatchObject({
      kind: "step",
      stepId: "done",
    });

    await store.saveExecution({
      id: "idle",
      workflowKey: "t",
      input: undefined,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await clearExecutionCurrent(store, "idle");
    expect((await store.getExecution("idle"))?.current).toBeUndefined();
  });

  it("clears suspended current only when the same waiting slot is still active", async () => {
    const store = new MemoryStore();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");

    await store.saveExecution({
      id: "sleeping",
      workflowKey: "t",
      input: undefined,
      status: "sleeping",
      current: createSignalWaitCurrent({
        stepId: "__signal:paid",
        signalId: "paid",
        startedAt,
      }),
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await clearExecutionCurrentIfSuspendedOnStep(store, "sleeping", {
      stepId: "__signal:paid",
      kinds: ["waitForSignal"],
    });
    expect((await store.getExecution("sleeping"))?.current).toBeUndefined();

    await store.saveExecution({
      id: "mismatch",
      workflowKey: "t",
      input: undefined,
      status: "sleeping",
      current: createExecutionWaitCurrent({
        stepId: "__execution:child",
        targetExecutionId: "child",
        targetWorkflowKey: "canonical.child",
        startedAt,
      }),
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await clearExecutionCurrentIfSuspendedOnStep(store, "mismatch", {
      stepId: "__execution:other",
      kinds: ["waitForExecution"],
    });
    expect((await store.getExecution("mismatch"))?.current).toMatchObject({
      kind: "waitForExecution",
      stepId: "__execution:child",
    });

    await store.saveExecution({
      id: "running",
      workflowKey: "t",
      input: undefined,
      status: "running",
      current: createSleepCurrent({
        stepId: "__sleep:stable",
        fireAtMs: startedAt.getTime() + 1000,
        timerId: "sleep:e1:stable",
        startedAt,
      }),
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await clearExecutionCurrentIfSuspendedOnStep(store, "running", {
      stepId: "__sleep:stable",
      kinds: ["sleep"],
    });
    expect((await store.getExecution("running"))?.current).toMatchObject({
      kind: "sleep",
      stepId: "__sleep:stable",
    });
  });

  it("parses waiting states in their supported shapes", () => {
    expect(
      parseSignalState({
        state: "waiting",
        signalId: "paid",
      }),
    ).toEqual({
      state: "waiting",
      signalId: "paid",
      timerId: undefined,
    });

    expect(
      parseExecutionWaitState({
        state: "waiting",
        targetExecutionId: "child-exec",
      }),
    ).toEqual({
      state: "waiting",
      targetExecutionId: "child-exec",
    });

    expect(parseSignalState("nope")).toBeNull();
    expect(parseSignalState({ state: "completed", signalId: "paid" })).toEqual({
      state: "completed",
      signalId: "paid",
    });
    expect(parseSignalState({ state: "timed_out", signalId: "paid" })).toEqual({
      state: "timed_out",
      signalId: "paid",
    });

    expect(parseExecutionWaitState("nope")).toBeNull();
    expect(parseExecutionWaitState({ state: "waiting" })).toBeNull();
    expect(
      parseExecutionWaitState({
        state: "completed",
        targetExecutionId: "child-exec",
      }),
    ).toBeNull();
    expect(
      parseExecutionWaitState({
        state: "completed",
        targetExecutionId: "child-exec",
        workflowKey: "canonical.child",
        result: "ok",
      }),
    ).toEqual({
      state: "completed",
      targetExecutionId: "child-exec",
      workflowKey: "canonical.child",
      result: "ok",
    });
    expect(
      parseExecutionWaitState({
        state: "failed",
        targetExecutionId: "child-exec",
        workflowKey: "canonical.child",
        attempt: 2,
        error: { message: "boom" },
      }),
    ).toEqual({
      state: "failed",
      targetExecutionId: "child-exec",
      workflowKey: "canonical.child",
      attempt: 2,
      error: { message: "boom", stack: undefined },
    });
    expect(
      parseExecutionWaitState({
        state: "cancelled",
        targetExecutionId: "child-exec",
        workflowKey: "canonical.child",
        attempt: 3,
        error: { message: "stop", stack: "trace" },
      }),
    ).toEqual({
      state: "cancelled",
      targetExecutionId: "child-exec",
      workflowKey: "canonical.child",
      attempt: 3,
      error: { message: "stop", stack: "trace" },
    });
    expect(
      parseExecutionWaitState({
        state: "timed_out",
        targetExecutionId: "child-exec",
      }),
    ).toEqual({
      state: "timed_out",
      targetExecutionId: "child-exec",
    });
    expect(
      parseExecutionWaitState({
        state: "failed",
        targetExecutionId: "child-exec",
        workflowKey: "canonical.child",
        attempt: "bad",
        error: { message: "boom" },
      }),
    ).toBeNull();
    expect(
      parseExecutionWaitState({
        state: "waiting",
        targetExecutionId: "child-timeout",
        timeoutMs: 2000,
      }),
    ).toEqual({
      state: "waiting",
      targetExecutionId: "child-timeout",
    });
  });

  it("covers durable utility helpers used by current-state tracking", () => {
    expect(
      parseSignalState({
        state: "completed",
        signalId: "paid",
      }),
    ).toEqual({
      state: "completed",
      signalId: "paid",
    });
    expect(
      parseSignalState({
        state: "timed_out",
        signalId: "paid",
      }),
    ).toEqual({
      state: "timed_out",
      signalId: "paid",
    });
    expect(
      parseExecutionWaitState({
        state: "timed_out",
        targetExecutionId: "child-timeout",
      }),
    ).toEqual({
      state: "timed_out",
      targetExecutionId: "child-timeout",
    });

    expect(shouldPersistStableSignalId("__signal:paid", "paid")).toBe(false);
    expect(shouldPersistStableSignalId("__signal:paid:1", "paid")).toBe(false);
    expect(shouldPersistStableSignalId("__signal:custom", "paid")).toBe(true);

    const error = new DurableExecutionError("boom", "exec-1", "task-1", 2, {
      message: "cause",
    });

    expect(error.executionId).toBe("exec-1");
    expect(error.workflowKey).toBe("task-1");
    expect(error.workflowKey).toBe("task-1");
    expect(error.attempt).toBe(2);
    expect(error.causeInfo).toEqual({ message: "cause" });
  });
});
