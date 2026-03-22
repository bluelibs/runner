import { defineEvent, r } from "../../..";
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
});
