import { defineEvent, r } from "../../..";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { DurableContext } from "../../durable/core/DurableContext";
import { DurableExecutionError } from "../../durable/core/DurableService";
import type { DurableAuditEmitter } from "../../durable/core/audit";
import { createDurableStepId } from "../../durable/core/ids";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import { handleExecutionWaitTimeoutTimer } from "../../durable/core/managers/PollingManager.timerHandlers";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { durableWorkflowTag } from "../../durable/tags/durableWorkflow.tag";
import { genericError } from "../../../errors";
import type { ITask } from "../../../types/task";
import { createBareStore } from "./DurableService.unit.helpers";

describe("durable: DurableContext", () => {
  const Paid = defineEvent<{ paidAt: number }>({ id: "durable-tests-paid" });
  const Refunded = defineEvent<{ refundedAt: number }>({
    id: "durable-tests-refunded",
  });
  const ChildObjectTask = r
    .task("child-task")
    .run(async () => ({ ok: true }))
    .build();
  const ChildTextTask = r
    .task("child-task")
    .run(async () => "ok")
    .build();
  const ChildWorkflowTask = r
    .task("child-workflow-task")
    .tags([durableWorkflowTag.with({ category: "tests" })])
    .run(async () => "child-ok")
    .build();
  type ExecutionCurrent = NonNullable<
    Awaited<ReturnType<MemoryStore["getExecution"]>>
  >["current"];
  const createContext = (
    executionId = "e1",
    attempt = 1,
    store: IDurableStore = new MemoryStore(),
    options: {
      auditEnabled?: boolean;
      auditEmitter?: DurableAuditEmitter;
      implicitInternalStepIds?: "allow" | "warn" | "error";
      declaredSignalIds?: ReadonlySet<string> | null;
      startWorkflowExecution?: <TInput, TResult>(
        task: ITask<TInput, Promise<TResult>, any, any, any, any>,
        input: TInput | undefined,
        options: {
          timeout?: number;
          priority?: number;
          parentExecutionId: string;
          idempotencyKey: string;
        },
      ) => Promise<string>;
      getTaskPersistenceId?: (
        task: ITask<any, Promise<any>, any, any, any, any>,
      ) => string;
    } = {},
  ) => {
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, executionId, attempt, options);
    return { store, bus, ctx };
  };

  it("fails fast when the execution is cancelled (default message)", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Cancelled,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(ctx.sleep(1, { stepId: "stable" })).rejects.toThrow(
      "Execution cancelled",
    );
  });

  it("supports explicit compensation via rollback()", async () => {
    const { ctx } = createContext();

    const actions: string[] = [];

    await ctx
      .step<string>("create")
      .up(async () => {
        actions.push("up");
        return "ok";
      })
      .down(async () => {
        actions.push("down");
      });

    await ctx.rollback();

    expect(actions).toEqual(["up", "down"]);
  });

  it("clears stale current when replay returns a cached step result", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      current: {
        kind: "step",
        stepId: "cached",
        startedAt: new Date(),
      },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "cached",
      result: "ok",
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);
    await expect(ctx.step("cached", async () => "nope")).resolves.toBe("ok");
    expect((await store.getExecution("e1"))?.current).toBeUndefined();
  });

  it("tracks active step current state before executing new work", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);
    let currentDuringStep: ExecutionCurrent;

    await ctx.step("create", async () => {
      currentDuringStep = (await store.getExecution("e1"))?.current;
      return "ok";
    });

    expect(currentDuringStep).toMatchObject({
      kind: "step",
      stepId: "create",
    });
  });

  it("clears current after a step completes", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);
    await ctx.step("create", async () => "ok");

    expect((await store.getExecution("e1"))?.current).toBeUndefined();
  });

  it("tracks workflow steps as step current with workflow metadata", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "parent",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let currentDuringWorkflow: ExecutionCurrent | undefined;
    const { ctx } = createContext("e1", 1, store, {
      startWorkflowExecution: async () => {
        currentDuringWorkflow = (await store.getExecution("e1"))?.current;
        return "child-execution";
      },
      getTaskPersistenceId: () => "canonical.child-workflow-task",
    });

    await expect(ctx.workflow("start-child", ChildWorkflowTask)).resolves.toBe(
      "child-execution",
    );

    expect(currentDuringWorkflow).toMatchObject({
      kind: "step",
      stepId: "start-child",
      meta: {
        childWorkflowKey: "canonical.child-workflow-task",
      },
    });
  });

  it("clears current after a completed sleep resumes", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      current: {
        kind: "sleep",
        stepId: "__sleep:stable-sleep",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        waitingFor: {
          type: "sleep",
          params: {
            durationMs: 1000,
            fireAtMs: Date.now() - 1,
            timerId: "sleep:e1:__sleep:stable-sleep",
          },
        },
      },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__sleep:stable-sleep",
      result: { state: "completed" },
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);
    await expect(ctx.sleep(1_000, { stepId: "stable-sleep" })).resolves.toBe(
      undefined,
    );

    expect((await store.getExecution("e1"))?.current).toBeUndefined();
  });

  it("rethrows SuspensionSignal from rollback()", async () => {
    const { ctx } = createContext();

    await ctx
      .step<string>("create")
      .up(async () => "ok")
      .down(async () => {
        throw new SuspensionSignal("yield");
      });

    await expect(ctx.rollback()).rejects.toBeInstanceOf(SuspensionSignal);
  });

  it("marks compensation_failed even when a non-Error is thrown", async () => {
    const { store, ctx } = createContext();

    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx
      .step<string>("create")
      .up(async () => "ok")
      .down(async () => {
        throw "boom";
      });

    await expect(ctx.rollback()).rejects.toThrow("Compensation failed");
    expect((await store.getExecution("e1"))?.status).toBe(
      "compensation_failed",
    );
    expect((await store.getExecution("e1"))?.error?.stack).toBeUndefined();
  });

  it("creates a deterministic sleep step and suspends", async () => {
    const { store, ctx } = createContext();

    await expect(ctx.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);

    const step = await store.getStepResult("e1", "__sleep:0");
    expect(step?.result).toEqual(
      expect.objectContaining({ state: "sleeping" }),
    );

    expect((await store.getReadyTimers(new Date(Date.now() + 10))).length).toBe(
      1,
    );
  });

  it("cleans up a freshly created sleep timer when persisting the sleep checkpoint fails", async () => {
    class SleepCheckpointFailingStore extends MemoryStore {
      override async saveStepResult(
        stepResult: Parameters<MemoryStore["saveStepResult"]>[0],
      ): Promise<void> {
        if (stepResult.stepId === "__sleep:stable-sleep") {
          throw new Error("sleep checkpoint write failed");
        }

        await super.saveStepResult(stepResult);
      }
    }

    const store = new SleepCheckpointFailingStore();
    const { ctx } = createContext("e1", 1, store);

    await expect(ctx.sleep(10_000, { stepId: "stable-sleep" })).rejects.toThrow(
      "sleep checkpoint write failed",
    );

    expect(await store.getStepResult("e1", "__sleep:stable-sleep")).toBeNull();
    expect(await store.getReadyTimers(new Date(Date.now() + 60_000))).toEqual(
      [],
    );
  });

  it("fails fast when replay finds an invalid persisted sleep state", async () => {
    const store = new MemoryStore();
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__sleep:stable-sleep",
      result: {
        state: "sleeping",
        fireAtMs: Date.now() + 10_000,
      },
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(ctx.sleep(10_000, { stepId: "stable-sleep" })).rejects.toThrow(
      "Invalid sleep step state",
    );
  });

  it("can enforce explicit step ids for internal steps (sleep)", async () => {
    const { ctx } = createContext("e1", 1, new MemoryStore(), {
      implicitInternalStepIds: "error",
    });

    await expect(ctx.sleep(1)).rejects.toThrow("implicit step id");
  });

  it("can warn once per kind when using implicit internal step ids", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { ctx } = createContext("e1", 1, new MemoryStore(), {
        implicitInternalStepIds: "warn",
      });

      await expect(ctx.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);
      await expect(ctx.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);

      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("replays sleep when already sleeping (re-creates timer and suspends again)", async () => {
    const { store, bus } = createContext();
    const ctx1 = new DurableContext(store, bus, "e1", 1);
    await expect(ctx1.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);

    const ctx2 = new DurableContext(store, bus, "e1", 1);
    await expect(ctx2.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);
  });

  it("returns immediately if sleep is already completed", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__sleep:0",
      result: { state: "completed" },
      completedAt: new Date(),
    });

    await expect(ctx.sleep(1)).resolves.toBeUndefined();
  });

  it("workflow() injects parentExecutionId and a default idempotency key", async () => {
    const startWorkflowExecution = jest.fn(async () => "child-execution-id");
    const { store, ctx } = createContext(
      "parent-execution",
      1,
      new MemoryStore(),
      {
        startWorkflowExecution,
      },
    );

    await expect(ctx.workflow("start-child", ChildWorkflowTask)).resolves.toBe(
      "child-execution-id",
    );

    expect(startWorkflowExecution).toHaveBeenCalledWith(
      ChildWorkflowTask,
      undefined,
      {
        parentExecutionId: "parent-execution",
        idempotencyKey: "subflow:parent-execution:start-child",
        priority: undefined,
        timeout: undefined,
      },
    );
    await expect(
      store.getStepResult("parent-execution", "start-child"),
    ).resolves.toEqual(
      expect.objectContaining({
        result: "child-execution-id",
      }),
    );
  });

  it("workflow() preserves explicit idempotency keys", async () => {
    const startWorkflowExecution = jest.fn(async () => "child-execution-id");
    const { ctx } = createContext("parent-execution", 1, new MemoryStore(), {
      startWorkflowExecution,
    });

    await expect(
      ctx.workflow("start-child", ChildWorkflowTask, undefined, {
        idempotencyKey: "custom-idempotency",
        timeout: 1_000,
      }),
    ).resolves.toBe("child-execution-id");

    expect(startWorkflowExecution).toHaveBeenCalledWith(
      ChildWorkflowTask,
      undefined,
      {
        parentExecutionId: "parent-execution",
        idempotencyKey: "custom-idempotency",
        priority: undefined,
        timeout: 1_000,
      },
    );
  });

  it("workflow() fails fast when the child task is not tagged as durable", async () => {
    const startWorkflowExecution = jest.fn(async () => "child-execution-id");
    const { ctx } = createContext("parent-execution", 1, new MemoryStore(), {
      startWorkflowExecution,
    });

    await expect(ctx.workflow("start-child", ChildTextTask)).rejects.toThrow(
      "not tagged as a durable workflow",
    );
    expect(startWorkflowExecution).not.toHaveBeenCalled();
  });

  it("workflow() fails fast when durable workflow starts are unavailable in this context", async () => {
    const { ctx } = createContext("parent-execution", 1, new MemoryStore());

    await expect(
      ctx.workflow("start-child", ChildWorkflowTask),
    ).rejects.toThrow(
      "Durable workflow starts are not available in this context.",
    );
  });

  it("workflow() uses its default idempotency key to avoid duplicate child creates after a step-save failure", async () => {
    class StepSaveFailsOnceStore extends MemoryStore {
      private failed = false;

      override async saveStepResult(result: {
        executionId: string;
        stepId: string;
        result: unknown;
        completedAt: Date;
      }): Promise<void> {
        if (
          !this.failed &&
          result.executionId === "parent" &&
          result.stepId === "start-child"
        ) {
          this.failed = true;
          throw new Error("step-save-failed");
        }

        await super.saveStepResult(result);
      }
    }

    const store = new StepSaveFailsOnceStore();
    const startWorkflowExecution = async <TInput, TResult>(
      task: ITask<TInput, Promise<TResult>, any, any, any, any>,
      _input: TInput | undefined,
      options: {
        timeout?: number;
        priority?: number;
        parentExecutionId: string;
        idempotencyKey: string;
      },
    ): Promise<string> => {
      const executionId = `child:${options.idempotencyKey}`;
      const created = await store.createExecutionWithIdempotencyKey!({
        execution: {
          id: executionId,
          workflowKey: task.id,
          parentExecutionId: options.parentExecutionId,
          input: undefined,
          status: ExecutionStatus.Pending,
          attempt: 1,
          maxAttempts: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        workflowKey: task.id,
        idempotencyKey: options.idempotencyKey,
      });

      return created.executionId;
    };

    const first = new DurableContext(store, new MemoryEventBus(), "parent", 1, {
      startWorkflowExecution,
    });
    await expect(
      first.workflow("start-child", ChildWorkflowTask),
    ).rejects.toThrow("step-save-failed");

    const replay = new DurableContext(
      store,
      new MemoryEventBus(),
      "parent",
      1,
      { startWorkflowExecution },
    );
    await expect(
      replay.workflow("start-child", ChildWorkflowTask),
    ).resolves.toBe("child:subflow:parent:start-child");

    await expect(store.listExecutions({})).resolves.toEqual([
      expect.objectContaining({
        id: "child:subflow:parent:start-child",
        parentExecutionId: "parent",
      }),
    ]);
  });

  it("memoizes steps, supports retries and timeouts", async () => {
    const { store, bus } = createContext();
    const ctx1 = new DurableContext(store, bus, "e1", 1);

    let count = 0;
    const v1 = await ctx1.step("cached", async () => {
      count += 1;
      return "ok";
    });

    // Simulate replay: new context, same execution ID
    const ctx2 = new DurableContext(store, bus, "e1", 1);
    const v2 = await ctx2.step("cached", async () => {
      count += 1;
      return "nope";
    });

    expect(v1).toBe("ok");
    expect(v2).toBe("ok");
    expect(count).toBe(1); // Ran once, second time was cached

    let attempts = 0;
    const retried = await ctx1.step("retry", { retries: 1 }, async () => {
      attempts += 1;
      if (attempts === 1) throw genericError.new({ message: "fail-once" });
      return "recovered";
    });
    expect(retried).toBe("recovered");

    await expect(
      ctx1.step(
        "timeout",
        { timeout: 1 },
        async () =>
          await new Promise<string>((resolve) =>
            setTimeout(() => resolve("late"), 25),
          ),
      ),
    ).rejects.toThrow("timed out");
  });

  it("does not retry a step after a timeout because the original body may still be running", async () => {
    const { ctx } = createContext();

    let attempts = 0;

    await expect(
      ctx.step("timeout-no-retry", { timeout: 1, retries: 3 }, async () => {
        attempts += 1;
        return await new Promise<string>((resolve) => {
          setTimeout(() => resolve("late"), 25);
        });
      }),
    ).rejects.toThrow("timed out");

    expect(attempts).toBe(1);
  });

  it("clears timeout timers when a step resolves or rejects quickly", async () => {
    const { ctx } = createContext();

    await expect(
      ctx.step("timeout-fast-resolve", { timeout: 50 }, async () => "ok"),
    ).resolves.toBe("ok");

    await expect(
      ctx.step("timeout-fast-reject", { timeout: 50 }, async () => {
        throw genericError.new({ message: "boom" });
      }),
    ).rejects.toThrow("boom");
  });

  it("registers compensation from cached step results", async () => {
    const { store, bus } = createContext();

    const actions: string[] = [];

    const ctx1 = new DurableContext(store, bus, "e1", 1);
    await ctx1
      .step("s1")
      .up(async () => "v")
      .down(async () => {
        actions.push("down");
      });

    const ctx2 = new DurableContext(store, bus, "e1", 1);
    await ctx2
      .step("s1")
      .up(async () => "ignored")
      .down(async () => {
        actions.push("down-cached");
      });

    await ctx2.rollback();
    expect(actions).toEqual(["down-cached"]);
  });

  it("supports strongly-typed step ids", async () => {
    const { store, bus } = createContext();
    const ctx1 = new DurableContext(store, bus, "e1", 1);

    const Create = createDurableStepId<string>("steps-create");

    let runs = 0;
    const v1 = await ctx1.step(Create, async () => {
      runs += 1;
      return "ok";
    });

    // Simulate replay
    const ctx2 = new DurableContext(store, bus, "e1", 1);
    const v2 = await ctx2.step(Create, async () => {
      runs += 1;
      return "nope";
    });

    expect(v1).toBe("ok");
    expect(v2).toBe("ok");
    expect(runs).toBe(1);
  });

  it("emits events using event definitions", async () => {
    const { bus, ctx } = createContext();

    const received: Array<{ type: string; payload: unknown }> = [];
    await bus.subscribe("durable:events", async (evt) => {
      received.push({ type: evt.type, payload: evt.payload });
    });

    const E1 = defineEvent<{ a: number }>({ id: "event-1" });
    const E2 = defineEvent<{ b: number }>({ id: "event-2" });
    const E3 = defineEvent<{ c: number }>({ id: "event-3" });

    await ctx.emit(E1, { a: 1 });
    await ctx.emit(E1, { a: 2 });
    await ctx.emit(E2, { b: 2 });
    await ctx.emit(E3, { c: 3 });

    expect(received).toEqual([
      { type: "event-1", payload: { a: 1 } },
      { type: "event-1", payload: { a: 2 } },
      { type: "event-2", payload: { b: 2 } },
      { type: "event-3", payload: { c: 3 } },
    ]);
  });

  it("prevents user steps from using internal reserved step ids", async () => {
    const { ctx } = createContext();

    expect(() => ctx.step("__sleep:0", async () => "x")).toThrow(
      "reserved for durable internals",
    );
    expect(() => ctx.step("rollback:s1", async () => "x")).toThrow(
      "reserved for durable internals",
    );
  });

  it("waits for a signal by persisting 'waiting' state and suspending", async () => {
    const { store, ctx } = createContext();

    await expect(ctx.waitForSignal(Paid)).rejects.toBeInstanceOf(
      SuspensionSignal,
    );
    expect(
      (await store.getStepResult("e1", "__signal:durable-tests-paid"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting", signalId: Paid.id }));
  });

  it("consumes the pending queued signal before suspending", async () => {
    const { store, ctx } = createContext();
    const queuedRecord = {
      id: "sig-1",
      payload: { paidAt: 7 },
      receivedAt: new Date(),
    };

    await store.appendSignalRecord!("e1", Paid.id, {
      id: queuedRecord.id,
      payload: queuedRecord.payload,
      receivedAt: queuedRecord.receivedAt,
    });
    await store.enqueueQueuedSignalRecord!("e1", Paid.id, queuedRecord);

    await expect(ctx.waitForSignal(Paid)).resolves.toEqual({
      kind: "signal",
      payload: { paidAt: 7 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:durable-tests-paid"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 7 } });
    expect((await store.getSignalState!("e1", Paid.id))?.queued).toEqual([]);
    expect((await store.getSignalState!("e1", Paid.id))?.history).toHaveLength(
      1,
    );
  });

  it("consumes the pending queued signal for explicit signal step ids", async () => {
    const { store, ctx } = createContext();
    const queuedRecord = {
      id: "sig-explicit",
      payload: { paidAt: 9 },
      receivedAt: new Date(),
    };
    await store.appendSignalRecord!("e1", Paid.id, {
      id: queuedRecord.id,
      payload: { paidAt: 9 },
      receivedAt: queuedRecord.receivedAt,
    });
    await store.enqueueQueuedSignalRecord!("e1", Paid.id, queuedRecord);

    await expect(
      ctx.waitForSignal(Paid, { stepId: "stable-paid" }),
    ).resolves.toEqual({ kind: "signal", payload: { paidAt: 9 } });
    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual({
      state: "completed",
      signalId: Paid.id,
      payload: { paidAt: 9 },
    });
    expect((await store.getSignalState!("e1", Paid.id))?.queued).toEqual([]);
  });

  it("rejects an explicit signal step replay when the persisted signal id changed", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: {
        state: "completed",
        signalId: Paid.id,
        payload: { paidAt: 9 },
      },
      completedAt: new Date(),
    });

    await expect(
      ctx.waitForSignal(Refunded, { stepId: "stable-paid" }),
    ).rejects.toThrow("Invalid signal step state");
  });

  it("throws when waitForSignal() uses an undeclared signal", async () => {
    const { ctx } = createContext("e1", 1, new MemoryStore(), {
      declaredSignalIds: new Set(["another-signal"]),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "not declared in durableWorkflow.signals",
    );
  });

  it("allows waitForSignal() when the signal is declared", async () => {
    const { store, ctx } = createContext("e1", 1, new MemoryStore(), {
      declaredSignalIds: new Set([Paid.id]),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toBeInstanceOf(
      SuspensionSignal,
    );
    expect(
      (await store.getStepResult("e1", "__signal:durable-tests-paid"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting", signalId: Paid.id }));
  });

  it("suspends again when signal is still waiting (replay branch)", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toBeInstanceOf(
      SuspensionSignal,
    );
  });

  it("consumes a buffered signal before re-registering a replayed waiting step", async () => {
    const { store, bus } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await store.bufferSignalRecord("e1", Paid.id, {
      id: "sig-1",
      payload: { paidAt: 77 },
      receivedAt: new Date(),
    });

    const replayedCtx = new DurableContext(store, bus, "e1", 1);

    await expect(replayedCtx.waitForSignal(Paid)).resolves.toEqual({
      kind: "signal",
      payload: { paidAt: 77 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:durable-tests-paid"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 77 },
    });
    expect(await store.peekNextSignalWaiter("e1", Paid.id)).toBeNull();
    expect((await store.getSignalState("e1", Paid.id))?.queued).toEqual([]);
  });

  it("replays buffered signals for implicit signal ids ending in numeric suffixes", async () => {
    const { store, bus } = createContext();
    const VersionedSignal = defineEvent<{ version: number }>({
      id: "order:1",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:order:1",
      result: { state: "waiting", signalId: VersionedSignal.id },
      completedAt: new Date(),
    });
    await store.bufferSignalRecord("e1", VersionedSignal.id, {
      id: "sig-order-1",
      payload: { version: 1 },
      receivedAt: new Date(),
    });

    const replayedCtx = new DurableContext(store, bus, "e1", 1);

    await expect(replayedCtx.waitForSignal(VersionedSignal)).resolves.toEqual({
      kind: "signal",
      payload: { version: 1 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:order:1"))?.result,
    ).toEqual({
      state: "completed",
      signalId: VersionedSignal.id,
      payload: { version: 1 },
    });
    expect(
      (await store.getSignalState("e1", VersionedSignal.id))?.queued,
    ).toEqual([]);
  });

  it("returns signal payload when completed and supports multiple waits", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });

    const paid = await ctx.waitForSignal(Paid);
    expect(paid).toEqual({ kind: "signal", payload: { paidAt: 1 } });

    await expect(ctx.waitForSignal(Paid)).rejects.toBeInstanceOf(
      SuspensionSignal,
    );
    expect(
      (await store.getStepResult("e1", "__signal:durable-tests-paid:1"))
        ?.result,
    ).toEqual(expect.objectContaining({ state: "waiting", signalId: Paid.id }));

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:raw",
      result: "hello",
      completedAt: new Date(),
    });

    const Raw = defineEvent<string>({ id: "raw" });
    await expect(ctx.waitForSignal(Raw)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("supports waitForSignal() using typed signal ids", async () => {
    const { store, ctx } = createContext();

    const PaidSignal = defineEvent<{ paidAt: number }>({ id: Paid.id });

    await store.saveStepResult({
      executionId: "e1",
      stepId: `__signal:${Paid.id}`,
      result: { state: "completed", payload: { paidAt: 123 } },
      completedAt: new Date(),
    });

    const paid = await ctx.waitForSignal(PaidSignal);
    expect(paid).toEqual({ kind: "signal", payload: { paidAt: 123 } });
  });

  it("supports signal timeout waits (and handles replay + timed_out)", async () => {
    const { store, bus, ctx } = createContext();

    await expect(
      ctx.waitForSignal(Paid, { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    const waiting = await store.getStepResult(
      "e1",
      "__signal:durable-tests-paid",
    );
    expect(waiting?.result).toEqual(
      expect.objectContaining({
        state: "waiting",
        timeoutAtMs: expect.any(Number),
        timerId: expect.any(String),
      }),
    );

    const ctx2 = new DurableContext(store, bus, "e1", 1);
    await expect(
      ctx2.waitForSignal(Paid, { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });

    const ctx3 = new DurableContext(store, bus, "e1", 1);
    await expect(ctx3.waitForSignal(Paid, { timeoutMs: 10 })).resolves.toEqual({
      kind: "timeout",
    });
  });

  it("returns timeout when signal is timed out without explicit timeout options", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).resolves.toEqual({
      kind: "timeout",
    });
  });

  it("creates a timeout timer when replaying a plain waiting signal", async () => {
    const { store, bus } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    const ctx = new DurableContext(store, bus, "e1", 1);
    await expect(
      ctx.waitForSignal(Paid, { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers.some((t) => t.type === "signal_timeout")).toBe(true);
  });

  it("preserves the original signal-timeout deadline when replayed waiting state lacks timer metadata", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const recordedAt = new Date(Date.now() - 4_000);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: {
        state: "waiting",
        signalId: Paid.id,
        timeoutMs: 10_000,
      },
      completedAt: recordedAt,
    });

    const ctx = new DurableContext(store, bus, "e1", 1);
    await expect(
      ctx.waitForSignal(Paid, { timeoutMs: 10_000 }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    const timer = timers.find((entry) => entry.type === "signal_timeout");
    expect(timer?.id).toBe("signal_timeout:e1:__signal:durable-tests-paid");
    expect(timer?.fireAt.getTime()).toBe(recordedAt.getTime() + 10_000);
  });

  it("consumes a buffered signal before re-registering a timeout-backed replayed waiting step", async () => {
    const { store, bus } = createContext();
    const timerId = "signal_timeout:e1:__signal:durable-tests-paid";

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: {
        state: "waiting",
        signalId: Paid.id,
        timeoutAtMs: Date.now() + 60_000,
        timerId,
      },
      completedAt: new Date(),
    });
    await store.createTimer({
      id: timerId,
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      type: "signal_timeout",
      fireAt: new Date(Date.now() + 60_000),
      status: "pending",
    });
    await store.bufferSignalRecord("e1", Paid.id, {
      id: "sig-timeout",
      payload: { paidAt: 88 },
      receivedAt: new Date(),
    });

    const replayedCtx = new DurableContext(store, bus, "e1", 1);

    await expect(
      replayedCtx.waitForSignal(Paid, { timeoutMs: 10 }),
    ).resolves.toEqual({
      kind: "signal",
      payload: { paidAt: 88 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:durable-tests-paid"))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 88 },
    });
    expect(await store.peekNextSignalWaiter("e1", Paid.id)).toBeNull();
    expect((await store.getSignalState("e1", Paid.id))?.queued).toEqual([]);

    const timers = await store.getReadyTimers(new Date(Date.now() + 120_000));
    expect(timers.some((timer) => timer.id === timerId)).toBe(false);
  });

  it("throws when a signal step result is an invalid primitive", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: 123,
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("throws when a signal step result has an unknown state", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: { state: "something-else", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("throws when a waiting signal step has an invalid signalId type", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: { state: "waiting", signalId: 123 },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("throws when a waiting signal step has a mismatched signalId", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable-tests-paid",
      result: { state: "waiting", signalId: "other-signal" },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("allows explicit signal step ids when the store implements the durable contract", async () => {
    const base = new MemoryStore();

    const storeNoList: IDurableStore = createBareStore(base);

    const { ctx } = createContext("e1", 1, storeNoList);

    await expect(
      ctx.waitForSignal(Paid, { stepId: "stable-paid" }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(await base.getStepResult("e1", "__signal:stable-paid")).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          state: "waiting",
          signalId: Paid.id,
        }),
      }),
    );
  });

  it("tracks sleep current state with typed waiting details", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(ctx.sleep(10_000, { stepId: "stable-sleep" })).rejects.toThrow(
      SuspensionSignal,
    );

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      kind: "sleep",
      stepId: "__sleep:stable-sleep",
      waitingFor: {
        type: "sleep",
        params: {
          durationMs: 10_000,
          timerId: "sleep:e1:__sleep:stable-sleep",
        },
      },
    });
  });

  it("preserves persisted sleep duration in current state on replay", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__sleep:stable-sleep",
      result: {
        state: "sleeping",
        timerId: "sleep:e1:__sleep:stable-sleep",
        fireAtMs: Date.now() + 5_000,
        durationMs: 5_000,
      },
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(ctx.sleep(10_000, { stepId: "stable-sleep" })).rejects.toThrow(
      SuspensionSignal,
    );

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      waitingFor: {
        type: "sleep",
        params: {
          durationMs: 5_000,
        },
      },
    });
  });

  it("tracks signal wait current state with typed waiting details", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForSignal(Paid, { stepId: "wait-paid", timeoutMs: 1_000 }),
    ).rejects.toThrow(SuspensionSignal);

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      kind: "waitForSignal",
      stepId: "__signal:wait-paid",
      waitingFor: {
        type: "signal",
        params: {
          signalId: Paid.id,
          timeoutMs: 1_000,
          timerId: "signal_timeout:e1:__signal:wait-paid",
        },
      },
    });
  });

  it("clears current when a persisted signal wait completes", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      current: {
        kind: "waitForSignal",
        stepId: "__signal:wait-paid",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        waitingFor: {
          type: "signal",
          params: {
            signalId: Paid.id,
            timeoutMs: 1_000,
            timeoutAtMs: Date.now() + 1_000,
            timerId: "signal_timeout:e1:__signal:wait-paid",
          },
        },
      },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:wait-paid",
      result: {
        state: "waiting",
        signalId: Paid.id,
        timeoutMs: 1_000,
        timeoutAtMs: Date.now() + 1_000,
        timerId: "signal_timeout:e1:__signal:wait-paid",
      },
      completedAt: new Date(),
    });
    await store.bufferSignalRecord("e1", Paid.id, {
      id: "record-1",
      payload: { paidAt: 1 },
      receivedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);
    await expect(
      ctx.waitForSignal(Paid, { stepId: "wait-paid", timeoutMs: 1_000 }),
    ).resolves.toEqual({
      kind: "signal",
      payload: { paidAt: 1 },
    });

    expect((await store.getExecution("e1"))?.current).toBeUndefined();
  });

  it("tracks no-timeout signal waits from fresh and replayed persisted state", async () => {
    const initialStore = new MemoryStore();
    await initialStore.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx: initialCtx } = createContext("e1", 1, initialStore);
    await expect(initialCtx.waitForSignal(Paid)).rejects.toThrow(
      SuspensionSignal,
    );
    expect((await initialStore.getExecution("e1"))?.current).toMatchObject({
      kind: "waitForSignal",
      stepId: `__signal:${Paid.id}`,
      waitingFor: {
        type: "signal",
        params: {
          signalId: Paid.id,
          timeoutMs: undefined,
        },
      },
    });

    const replayStore = new MemoryStore();
    const recordedAt = new Date("2024-01-02T03:04:05.000Z");
    await replayStore.saveExecution({
      id: "e2",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await replayStore.saveStepResult({
      executionId: "e2",
      stepId: `__signal:${Paid.id}`,
      result: { state: "waiting", signalId: Paid.id },
      completedAt: recordedAt,
    });

    const { ctx: replayCtx } = createContext("e2", 1, replayStore);
    await expect(replayCtx.waitForSignal(Paid)).rejects.toThrow(
      SuspensionSignal,
    );
    expect((await replayStore.getExecution("e2"))?.current).toMatchObject({
      kind: "waitForSignal",
      stepId: `__signal:${Paid.id}`,
      startedAt: recordedAt,
      waitingFor: {
        type: "signal",
        params: {
          signalId: Paid.id,
          timeoutMs: undefined,
        },
      },
    });
  });

  it("consumes buffered signals for default and explicit step ids", async () => {
    const defaultStore = new MemoryStore();
    await defaultStore.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await defaultStore.bufferSignalRecord("e1", Paid.id, {
      id: "record-1",
      payload: { paidAt: 1 },
      receivedAt: new Date(),
    });
    const { ctx: defaultCtx } = createContext("e1", 1, defaultStore);
    await expect(defaultCtx.waitForSignal(Paid)).resolves.toEqual({
      kind: "signal",
      payload: { paidAt: 1 },
    });
    expect(
      (await defaultStore.getStepResult("e1", `__signal:${Paid.id}`))?.result,
    ).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });

    const explicitStore = new MemoryStore();
    await explicitStore.saveExecution({
      id: "e2",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await explicitStore.bufferSignalRecord("e2", Paid.id, {
      id: "record-2",
      payload: { paidAt: 2 },
      receivedAt: new Date(),
    });
    const { ctx: explicitCtx } = createContext("e2", 1, explicitStore);
    await expect(
      explicitCtx.waitForSignal(Paid, {
        stepId: "custom-paid",
        timeoutMs: 500,
      }),
    ).resolves.toEqual({
      kind: "signal",
      payload: { paidAt: 2 },
    });
    expect(
      (await explicitStore.getStepResult("e2", "__signal:custom-paid"))?.result,
    ).toEqual({
      state: "completed",
      signalId: Paid.id,
      payload: { paidAt: 2 },
    });
  });

  it("tracks signal wait current state without timeout metadata for explicit step ids", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(SuspensionSignal);

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      kind: "waitForSignal",
      stepId: `__signal:${Paid.id}`,
      waitingFor: {
        type: "signal",
        params: {
          signalId: Paid.id,
        },
      },
    });
  });

  it("preserves persisted signal timeout in current state on replay", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:wait-paid",
      result: {
        state: "waiting",
        signalId: Paid.id,
        timeoutMs: 1_000,
        timeoutAtMs: Date.now() + 1_000,
        timerId: "signal_timeout:e1:__signal:wait-paid",
      },
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForSignal(Paid, { stepId: "wait-paid", timeoutMs: 9_999 }),
    ).rejects.toThrow(SuspensionSignal);

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      waitingFor: {
        type: "signal",
        params: {
          timeoutMs: 1_000,
        },
      },
    });
  });

  it("tracks signal wait current state without timeout metadata", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForSignal(Paid, { stepId: "wait-no-timeout" }),
    ).rejects.toThrow(SuspensionSignal);

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      waitingFor: {
        type: "signal",
        params: {
          signalId: Paid.id,
          timeoutMs: undefined,
        },
      },
    });
  });

  it("preserves persisted signal timeout metadata when replay rebuilds the timer", async () => {
    const store = new MemoryStore();
    const recordedAt = new Date("2024-01-02T03:04:05.000Z");
    await store.saveExecution({
      id: "e1",
      workflowKey: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:wait-timeout-replay",
      result: {
        state: "waiting",
        signalId: Paid.id,
        timeoutMs: 1_000,
      },
      completedAt: recordedAt,
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForSignal(Paid, {
        stepId: "wait-timeout-replay",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(SuspensionSignal);

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      kind: "waitForSignal",
      stepId: "__signal:wait-timeout-replay",
      waitingFor: {
        type: "signal",
        params: {
          signalId: Paid.id,
          timeoutMs: 1_000,
          timerId: "signal_timeout:e1:__signal:wait-timeout-replay",
        },
      },
    });
  });

  it("tracks execution wait current state with typed waiting details", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "parent",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveExecution({
      id: "child-exec",
      workflowKey: "canonical.child-task",
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store, {
      getTaskPersistenceId: () => "canonical.child-task",
    });

    await expect(
      ctx.waitForExecution(ChildTextTask, "child-exec", {
        stepId: "wait-child",
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow(SuspensionSignal);

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      kind: "waitForExecution",
      stepId: "__execution:wait-child",
      waitingFor: {
        type: "execution",
        params: {
          targetExecutionId: "child-exec",
          targetWorkflowKey: "canonical.child-task",
          timeoutMs: 2_000,
          timerId: "execution_timeout:e1:__execution:wait-child",
        },
      },
    });
  });

  it("clears current when a persisted execution wait completes", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "parent",
      input: undefined,
      status: ExecutionStatus.Running,
      current: {
        kind: "waitForExecution",
        stepId: "__execution:wait-child",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        waitingFor: {
          type: "execution",
          params: {
            targetExecutionId: "child-exec",
            targetWorkflowKey: "canonical.child-task",
            timeoutMs: 2_000,
            timeoutAtMs: Date.now() + 2_000,
            timerId: "execution_timeout:e1:__execution:wait-child",
          },
        },
      },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveExecution({
      id: "child-exec",
      workflowKey: "canonical.child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      attempt: 1,
      maxAttempts: 1,
      result: "ok",
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__execution:wait-child",
      result: {
        state: "waiting",
        targetExecutionId: "child-exec",
        timeoutMs: 2_000,
        timeoutAtMs: Date.now() + 2_000,
        timerId: "execution_timeout:e1:__execution:wait-child",
      },
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store, {
      getTaskPersistenceId: () => "canonical.child-task",
    });
    await expect(
      ctx.waitForExecution(ChildTextTask, "child-exec", {
        stepId: "wait-child",
        timeoutMs: 2_000,
      }),
    ).resolves.toEqual({
      kind: "completed",
      data: "ok",
    });

    expect((await store.getExecution("e1"))?.current).toBeUndefined();
  });

  it("tracks no-timeout execution waits from fresh and replayed persisted state", async () => {
    const initialStore = new MemoryStore();
    await initialStore.saveExecution({
      id: "e1",
      workflowKey: "parent",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await initialStore.saveExecution({
      id: "child-exec",
      workflowKey: "canonical.child-task",
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx: initialCtx } = createContext("e1", 1, initialStore, {
      getTaskPersistenceId: () => "canonical.child-task",
    });
    await expect(
      initialCtx.waitForExecution(ChildTextTask, "child-exec"),
    ).rejects.toThrow(SuspensionSignal);
    expect((await initialStore.getExecution("e1"))?.current).toMatchObject({
      kind: "waitForExecution",
      stepId: "__execution:child-exec",
      waitingFor: {
        type: "execution",
        params: {
          targetExecutionId: "child-exec",
          targetWorkflowKey: "canonical.child-task",
          timeoutMs: undefined,
        },
      },
    });

    const replayStore = new MemoryStore();
    const recordedAt = new Date("2024-01-02T03:04:05.000Z");
    await replayStore.saveExecution({
      id: "e2",
      workflowKey: "parent",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await replayStore.saveExecution({
      id: "child-exec-2",
      workflowKey: "canonical.child-task",
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await replayStore.saveStepResult({
      executionId: "e2",
      stepId: "__execution:child-exec-2",
      result: {
        state: "waiting",
        targetExecutionId: "child-exec-2",
      },
      completedAt: recordedAt,
    });

    const { ctx: replayCtx } = createContext("e2", 1, replayStore, {
      getTaskPersistenceId: () => "canonical.child-task",
    });
    await expect(
      replayCtx.waitForExecution(ChildTextTask, "child-exec-2"),
    ).rejects.toThrow(SuspensionSignal);
    expect((await replayStore.getExecution("e2"))?.current).toMatchObject({
      kind: "waitForExecution",
      stepId: "__execution:child-exec-2",
      startedAt: recordedAt,
      waitingFor: {
        type: "execution",
        params: {
          targetExecutionId: "child-exec-2",
          targetWorkflowKey: "canonical.child-task",
          timeoutMs: undefined,
        },
      },
    });
  });

  it("tracks execution wait current state without timeout metadata for explicit step ids", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "parent",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveExecution({
      id: "child-exec",
      workflowKey: "canonical.child-task",
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store, {
      getTaskPersistenceId: () => "canonical.child-task",
    });

    await expect(
      ctx.waitForExecution(ChildTextTask, "child-exec"),
    ).rejects.toThrow(SuspensionSignal);

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      kind: "waitForExecution",
      stepId: "__execution:child-exec",
      waitingFor: {
        type: "execution",
        params: {
          targetExecutionId: "child-exec",
          targetWorkflowKey: "canonical.child-task",
        },
      },
    });
  });

  it("preserves persisted execution timeout in current state on replay", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "parent",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveExecution({
      id: "child-exec",
      workflowKey: "canonical.child-task",
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__execution:wait-child",
      result: {
        state: "waiting",
        targetExecutionId: "child-exec",
        timeoutMs: 2_000,
        timeoutAtMs: Date.now() + 2_000,
        timerId: "execution_timeout:e1:__execution:wait-child",
      },
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store, {
      getTaskPersistenceId: () => "canonical.child-task",
    });

    await expect(
      ctx.waitForExecution(ChildTextTask, "child-exec", {
        stepId: "wait-child",
        timeoutMs: 9_999,
      }),
    ).rejects.toThrow(SuspensionSignal);

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      waitingFor: {
        type: "execution",
        params: {
          timeoutMs: 2_000,
        },
      },
    });
  });

  it("tracks execution wait current state without timeout metadata", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "parent",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveExecution({
      id: "child-exec",
      workflowKey: "canonical.child-task",
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store, {
      getTaskPersistenceId: () => "canonical.child-task",
    });

    await expect(
      ctx.waitForExecution(ChildTextTask, "child-exec", {
        stepId: "wait-no-timeout",
      }),
    ).rejects.toThrow(SuspensionSignal);

    expect((await store.getExecution("e1"))?.current).toMatchObject({
      waitingFor: {
        type: "execution",
        params: {
          targetExecutionId: "child-exec",
          timeoutMs: undefined,
        },
      },
    });
  });

  it("throws when waitForSignal() cannot acquire the signal lock", async () => {
    const base = new MemoryStore();

    const storeLocked: IDurableStore = createBareStore(base, {
      listStepResults: base.listStepResults.bind(base),
      acquireLock: async () => null,
      releaseLock: async () => {},
    });

    const { ctx } = createContext("e1", 1, storeLocked);

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow("signal lock");
  });

  it("supports explicit step ids for sleep, signals, and emits", async () => {
    const { store, ctx } = createContext();

    await expect(
      ctx.sleep(1, { stepId: "stable-sleep" }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(await store.getStepResult("e1", "__sleep:stable-sleep")).toEqual(
      expect.objectContaining({
        executionId: "e1",
        stepId: "__sleep:stable-sleep",
      }),
    );

    await expect(
      ctx.waitForSignal(Paid, { stepId: "stable-signal" }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(await store.getStepResult("e1", "__signal:stable-signal")).toEqual(
      expect.objectContaining({
        executionId: "e1",
        stepId: "__signal:stable-signal",
      }),
    );

    const Stable = defineEvent<{ ok: boolean }>({ id: "event-stable" });
    await ctx.emit(Stable, { ok: true }, { stepId: "stable-emit" });
    expect(await store.getStepResult("e1", "__emit:stable-emit")).toEqual(
      expect.objectContaining({
        executionId: "e1",
        stepId: "__emit:stable-emit",
      }),
    );
  });

  it("returns a signal outcome when completed and timeout options are used", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-complete",
      result: { state: "completed", payload: { paidAt: 7 } },
      completedAt: new Date(),
    });

    await expect(
      ctx.waitForSignal(Paid, { timeoutMs: 10, stepId: "stable-complete" }),
    ).resolves.toEqual({ kind: "signal", payload: { paidAt: 7 } });
  });

  it("returns the payload when an explicit step id is used without a timeout", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-only",
      result: { state: "completed", payload: { paidAt: 9 } },
      completedAt: new Date(),
    });

    await expect(
      ctx.waitForSignal(Paid, { stepId: "stable-only" }),
    ).resolves.toEqual({ kind: "signal", payload: { paidAt: 9 } });
  });

  it("returns timeout when an explicit step id is used without timeout options", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-timeout",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });

    await expect(
      ctx.waitForSignal(Paid, { stepId: "stable-timeout" }),
    ).resolves.toEqual({
      kind: "timeout",
    });
  });

  it("ignores audit emitter failures", async () => {
    const { ctx } = createContext("e1", 1, new MemoryStore(), {
      auditEnabled: true,
      auditEmitter: {
        emit: async () => {
          throw genericError.new({ message: "boom" });
        },
      },
    });

    await expect(ctx.step("audit-ok", async () => "ok")).resolves.toBe("ok");
  });

  it("ignores audit store failures", async () => {
    class ThrowingAuditStore extends MemoryStore {
      async appendAuditEntry(): Promise<void> {
        throw genericError.new({ message: "fail" });
      }
    }

    const store = new ThrowingAuditStore();
    const { ctx } = createContext("e1", 1, store, { auditEnabled: true });

    await expect(ctx.step("audit-fail", async () => "ok")).resolves.toBe("ok");
  });

  it("throws when reusing the same step ID in a single execution path", async () => {
    const { ctx } = createContext();
    await ctx.step("A", async () => "ok");

    // step() throws synchronously for duplicate IDs because it checks before returning the promise/builder
    expect(() => ctx.step("A", async () => "fail")).toThrow(
      "Duplicate step ID detected",
    );
  });

  it("returns a completed child execution result immediately", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "child-completed",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForExecution(ChildObjectTask, "child-completed"),
    ).resolves.toEqual({ ok: true });
    await expect(
      store.getStepResult("e1", "__execution:child-completed"),
    ).resolves.toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          state: "completed",
          workflowKey: "child-task",
          targetExecutionId: "child-completed",
          result: { ok: true },
        }),
      }),
    );
  });

  it("uses the durable persistence id when matching waitForExecution() task witnesses", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "child-completed",
      workflowKey: "canonical-child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store, {
      getTaskPersistenceId: (task) =>
        task === ChildObjectTask ? "canonical-child-task" : task.id,
    });

    await expect(
      ctx.waitForExecution(ChildObjectTask, "child-completed"),
    ).resolves.toEqual({ ok: true });
  });

  it("fails fast when waitForExecution() receives the wrong task witness", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "child-completed",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForExecution(ChildWorkflowTask, "child-completed"),
    ).rejects.toThrow("the stored durable execution belongs to 'child-task'");
  });

  it("fails fast when a cached completed wait result belongs to a different task", async () => {
    const store = new MemoryStore();
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__execution:child-cached",
      result: {
        state: "completed",
        targetExecutionId: "child-cached",
        workflowKey: "child-task",
        result: { ok: true },
      },
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForExecution(ChildWorkflowTask, "child-cached"),
    ).rejects.toThrow("the stored durable execution belongs to 'child-task'");
  });

  it("fails fast when a cached waiting state points to a missing child execution", async () => {
    const store = new MemoryStore();
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__execution:child-missing",
      result: {
        state: "waiting",
        targetExecutionId: "child-missing",
      },
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForExecution(ChildTextTask, "child-missing"),
    ).rejects.toThrow("target execution does not exist");
  });

  it("fails fast when waitForExecution() targets the current execution", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(ctx.waitForExecution(ChildTextTask, "e1")).rejects.toThrow(
      "an execution cannot wait for itself because it would deadlock",
    );
    await expect(store.listExecutionWaiters("e1")).resolves.toEqual([]);
    await expect(
      store.getReadyTimers(new Date(Date.now() + 10)),
    ).resolves.toEqual([]);
    await expect(
      store.getStepResult("e1", "__execution:e1"),
    ).resolves.toBeNull();
    const execution = await store.getExecution("e1");
    expect(execution).not.toBeNull();
    expect(execution).not.toHaveProperty("current");
  });

  it("throws a durable execution error when the child execution failed", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "child-failed",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Failed,
      error: { message: "child boom" },
      attempt: 3,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForExecution(ChildTextTask, "child-failed"),
    ).rejects.toBeInstanceOf(DurableExecutionError);
    const replayContext = new DurableContext(
      store,
      new MemoryEventBus(),
      "e1",
      1,
    );
    await expect(
      replayContext.waitForExecution(ChildTextTask, "child-failed"),
    ).rejects.toMatchObject({
      executionId: "child-failed",
      workflowKey: "child-task",
      attempt: 3,
      message: "child boom",
    });
  });

  it("suspends while waiting for another execution and returns timeout unions", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "child-pending",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForExecution(ChildTextTask, "child-pending", {
        stepId: "child-timeout",
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    await expect(store.listExecutionWaiters("child-pending")).resolves.toEqual([
      expect.objectContaining({
        executionId: "e1",
        targetExecutionId: "child-pending",
        stepId: "__execution:child-timeout",
      }),
    ]);

    const [timer] = await store.getReadyTimers(new Date(Date.now() + 10));
    expect(timer).toEqual(
      expect.objectContaining({
        executionId: "e1",
        stepId: "__execution:child-timeout",
        type: "timeout",
      }),
    );

    await expect(
      handleExecutionWaitTimeoutTimer({
        store,
        timer: timer!,
      }),
    ).resolves.toBe(true);

    const replayContext = new DurableContext(
      store,
      new MemoryEventBus(),
      "e1",
      1,
    );
    await expect(
      replayContext.waitForExecution(ChildTextTask, "child-pending", {
        stepId: "child-timeout",
        timeoutMs: 5,
      }),
    ).resolves.toEqual({ kind: "timeout" });
  });

  it("treats compensation_failed child executions as terminal failures", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "child-comp-failed",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.CompensationFailed,
      error: { message: "rollback blew up" },
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.waitForExecution(ChildTextTask, "child-comp-failed"),
    ).rejects.toBeInstanceOf(DurableExecutionError);
    const replayContext = new DurableContext(
      store,
      new MemoryEventBus(),
      "e1",
      1,
    );
    await expect(
      replayContext.waitForExecution(ChildTextTask, "child-comp-failed"),
    ).rejects.toMatchObject({
      message: "rollback blew up",
      executionId: "child-comp-failed",
      workflowKey: "child-task",
      attempt: 2,
    });
  });
});
