import { defineEvent, r } from "../../..";
import {
  clearExecutionCurrent,
  createExecutionWaitCurrent,
  createSignalWaitCurrent,
  createSleepCurrent,
  createStepCurrent,
  createSwitchCurrent,
  createWorkflowStepCurrent,
  setExecutionCurrent,
} from "../../durable/core/current";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import { sleepDurably } from "../../durable/core/durable-context/DurableContext.sleep";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { DurableContext } from "../../durable/core/DurableContext";
import { createDurableStepId } from "../../durable/core/ids";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { durableWorkflowTag } from "../../durable/tags/durableWorkflow.tag";
import * as waitForSignalModule from "../../durable/core/durable-context/DurableContext.waitForSignal";
import * as waitForExecutionModule from "../../durable/core/durable-context/DurableContext.waitForExecution";
import * as switchModule from "../../durable/core/durable-context/DurableContext.switch";
import * as stepsModule from "../../durable/core/durable-context/DurableContext.steps";

describe("durable: DurableContext coverage", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("covers workflow, wait, switch, rollback, note, and typed-step delegation", async () => {
    const Paid = defineEvent<{ paidAt: number }>({ id: "coverage-paid" });
    const childWorkflow = r
      .task("coverage-child-workflow")
      .tags([durableWorkflowTag.with({ category: "tests" })])
      .inputSchema<{ childId: string }>({ parse: (value: any) => value })
      .run(async () => "child-result")
      .build();
    const childTask = r
      .task("coverage-child-task")
      .run(async () => ({ ok: true }))
      .build();

    const waitForSignalSpy = jest
      .spyOn(waitForSignalModule, "waitForSignalDurably")
      .mockResolvedValue({ paidAt: 1 });
    const waitForExecutionSpy = jest
      .spyOn(waitForExecutionModule, "waitForExecutionDurably")
      .mockResolvedValue({ ok: true });
    const switchSpy = jest
      .spyOn(switchModule, "switchDurably")
      .mockResolvedValue("routed");
    const rollbackSpy = jest
      .spyOn(stepsModule, "rollbackDurableCompensations")
      .mockResolvedValue(undefined);
    const startWorkflowExecution = jest.fn(async () => "child-execution");

    const ctx = new DurableContext(
      new MemoryStore(),
      new MemoryEventBus(),
      "parent-execution",
      1,
      {
        declaredSignalIds: new Set([Paid.id]),
        startWorkflowExecution,
        getTaskPersistenceId: () => "persisted-child-task",
      },
    );

    await expect(
      ctx.step(createDurableStepId<string>("typed-step"), async () => "ok"),
    ).resolves.toBe("ok");
    await expect(
      ctx.workflow(
        "start-child",
        childWorkflow,
        { childId: "c1" },
        {
          priority: 2,
          timeout: 500,
        },
      ),
    ).resolves.toBe("child-execution");
    expect(startWorkflowExecution).toHaveBeenCalledWith(
      childWorkflow,
      { childId: "c1" },
      {
        parentExecutionId: "parent-execution",
        idempotencyKey: "subflow:parent-execution:start-child",
        priority: 2,
        timeout: 500,
      },
    );

    await expect(ctx.waitForSignal(Paid)).resolves.toEqual({ paidAt: 1 });
    expect(waitForSignalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "parent-execution",
        signal: Paid,
      }),
    );

    await expect(
      ctx.waitForExecution(childTask, "child-execution"),
    ).resolves.toEqual({ ok: true });
    expect(waitForExecutionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "parent-execution",
        targetExecutionId: "child-execution",
        expectedTaskId: "persisted-child-task",
      }),
    );

    await expect(
      ctx.switch(
        "route",
        "premium",
        [
          {
            id: "premium",
            match: (value) => value === "premium",
            run: async () => "ignored",
          },
        ],
        {
          id: "fallback",
          run: async () => "fallback",
        },
      ),
    ).resolves.toBe("routed");
    expect(switchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "parent-execution",
        stepId: "route",
      }),
    );

    await expect(ctx.rollback()).resolves.toBeUndefined();
    expect(rollbackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "parent-execution",
      }),
    );

    await expect(ctx.note("ignored")).resolves.toBeUndefined();
  });

  it("fails fast for undeclared signals and non-durable workflow tasks", async () => {
    const Paid = defineEvent<{ paidAt: number }>({ id: "coverage-paid-guard" });
    const nonDurableTask = r
      .task("coverage-non-durable-task")
      .run(async () => "ok")
      .build();
    const ctx = new DurableContext(
      new MemoryStore(),
      new MemoryEventBus(),
      "parent-execution",
      1,
      {
        declaredSignalIds: new Set(["other-signal"]),
      },
    );

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "not declared in durableWorkflow.signals",
    );
    await expect(ctx.workflow("start-child", nonDurableTask)).rejects.toThrow(
      "not tagged as a durable workflow",
    );
  });

  it("covers current helpers and store-backed current updates", async () => {
    const store = new MemoryStore();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");

    expect(createStepCurrent({ stepId: "step", startedAt })).toMatchObject({
      kind: "step",
      stepId: "step",
      startedAt,
    });
    expect(
      createWorkflowStepCurrent({
        stepId: "workflow-step",
        startedAt,
        meta: { workflowTaskId: "canonical.child" },
      }),
    ).toMatchObject({
      kind: "step",
      meta: { workflowTaskId: "canonical.child" },
    });
    expect(
      createSwitchCurrent({
        stepId: "switch",
        startedAt,
      }),
    ).toMatchObject({
      kind: "switch",
      stepId: "switch",
    });
    expect(
      createSleepCurrent({
        stepId: "__sleep:0",
        durationMs: 1000,
        fireAtMs: 2000,
        timerId: "sleep:e1:__sleep:0",
        startedAt,
      }),
    ).toMatchObject({
      kind: "sleep",
      waitingFor: { type: "sleep" },
    });
    expect(
      createSignalWaitCurrent({
        stepId: "__signal:paid",
        signalId: "paid",
        timeoutMs: 1000,
        timeoutAtMs: 2000,
        timerId: "signal_timeout:e1:__signal:paid",
        startedAt,
      }),
    ).toMatchObject({
      kind: "waitForSignal",
      waitingFor: { type: "signal" },
    });
    expect(
      createExecutionWaitCurrent({
        stepId: "__execution:child",
        targetExecutionId: "child",
        targetTaskId: "canonical.child",
        timeoutMs: 1000,
        timeoutAtMs: 2000,
        timerId: "execution_timeout:e1:__execution:child",
        startedAt,
      }),
    ).toMatchObject({
      kind: "waitForExecution",
      waitingFor: { type: "execution" },
    });

    await setExecutionCurrent(
      store,
      "missing",
      createStepCurrent({ stepId: "step", startedAt }),
    );
    await clearExecutionCurrent(store, "missing");

    await store.saveExecution({
      id: "running",
      taskId: "task",
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
      createStepCurrent({ stepId: "step", startedAt }),
    );
    expect((await store.getExecution("running"))?.current).toMatchObject({
      kind: "step",
      stepId: "step",
    });

    await clearExecutionCurrent(store, "running");
    expect((await store.getExecution("running"))?.current).toBeUndefined();

    await store.saveExecution({
      id: "completed",
      taskId: "task",
      input: undefined,
      status: "completed",
      current: createStepCurrent({ stepId: "done", startedAt }),
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    await setExecutionCurrent(
      store,
      "completed",
      createStepCurrent({ stepId: "ignored", startedAt }),
    );
    await clearExecutionCurrent(store, "completed");
    expect((await store.getExecution("completed"))?.current).toMatchObject({
      kind: "step",
      stepId: "done",
    });
  });

  it("covers sleep scheduling, replay, and completed cleanup", async () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const initialStore = new MemoryStore();
    await initialStore.saveExecution({
      id: "sleep-initial",
      taskId: "task",
      input: undefined,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      sleepDurably({
        store: initialStore,
        executionId: "sleep-initial",
        assertCanContinue: async () => {},
        appendAuditEntry: async () => {},
        assertUniqueStepId: () => {},
        assertOrWarnImplicitInternalStepId: () => {},
        sleepIndexRef: { current: 0 },
        durationMs: 1000,
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(
      (await initialStore.getExecution("sleep-initial"))?.current,
    ).toMatchObject({
      kind: "sleep",
      stepId: "__sleep:0",
    });

    const replayStore = new MemoryStore();
    await replayStore.saveExecution({
      id: "sleep-replay",
      taskId: "task",
      input: undefined,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await replayStore.saveStepResult({
      executionId: "sleep-replay",
      stepId: "__sleep:0",
      result: {
        state: "sleeping",
        timerId: "sleep:sleep-replay:__sleep:0",
        fireAtMs: Date.now() + 1000,
      },
      completedAt: startedAt,
    });

    await expect(
      sleepDurably({
        store: replayStore,
        executionId: "sleep-replay",
        assertCanContinue: async () => {},
        appendAuditEntry: async () => {},
        assertUniqueStepId: () => {},
        assertOrWarnImplicitInternalStepId: () => {},
        sleepIndexRef: { current: 0 },
        durationMs: 1000,
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(
      (await replayStore.getExecution("sleep-replay"))?.current,
    ).toMatchObject({
      kind: "sleep",
      startedAt,
    });

    const completedStore = new MemoryStore();
    await completedStore.saveExecution({
      id: "sleep-completed",
      taskId: "task",
      input: undefined,
      status: "running",
      current: createSleepCurrent({
        stepId: "__sleep:done",
        durationMs: 1,
        fireAtMs: 2,
        timerId: "sleep:sleep-completed:__sleep:done",
        startedAt,
      }),
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await completedStore.saveStepResult({
      executionId: "sleep-completed",
      stepId: "__sleep:done",
      result: { state: "completed" },
      completedAt: new Date(),
    });

    await expect(
      sleepDurably({
        store: completedStore,
        executionId: "sleep-completed",
        assertCanContinue: async () => {},
        appendAuditEntry: async () => {},
        assertUniqueStepId: () => {},
        assertOrWarnImplicitInternalStepId: () => {},
        sleepIndexRef: { current: 0 },
        durationMs: 1000,
        options: { stepId: "done" },
      }),
    ).resolves.toBeUndefined();
    expect(
      (await completedStore.getExecution("sleep-completed"))?.current,
    ).toBeUndefined();
  });
});
