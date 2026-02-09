import { r } from "../../..";
import type { IDurableContext } from "../../durable/core/interfaces/context";
import { DurableService } from "../../durable/core/DurableService";
import { ExecutionStatus, TimerType } from "../../durable/core/types";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../durable/store/MemoryStore";
import type { ITask } from "../../../types/task";

type WorkflowHandler = (ctx: IDurableContext, input: unknown) => Promise<any>;

function createContextCapturingService(params: {
  store: MemoryStore;
  eventBus: MemoryEventBus;
  task: ITask<any, Promise<any>, any, any, any, any>;
  handler: WorkflowHandler;
  execution?: { maxAttempts?: number };
}): DurableService {
  let activeContext: IDurableContext | null = null;

  return new DurableService({
    store: params.store,
    eventBus: params.eventBus,
    tasks: [params.task],
    execution: params.execution,
    contextProvider: async (ctx, fn) => {
      activeContext = ctx;
      try {
        return await fn();
      } finally {
        activeContext = null;
      }
    },
    taskExecutor: {
      run: async (task, input): Promise<any> => {
        if (task.id !== params.task.id) {
          throw new Error(`Unexpected task: ${task.id}`);
        }
        if (activeContext === null) {
          throw new Error("Durable context missing in taskExecutor");
        }
        return await params.handler(activeContext, input);
      },
    },
  });
}

describe("durable: crash recovery + resume (integration)", () => {
  it("resumes from last checkpoint after a restart (sleep)", async () => {
    const store = new MemoryStore();
    const task = r
      .task("durable.tests.crash-recovery.sleep")
      .run(async () => "unused")
      .build();

    let beforeRuns = 0;
    let afterRuns = 0;
    const handler: WorkflowHandler = async (ctx) => {
      const before = await ctx.step("before", async () => {
        beforeRuns += 1;
        return "before";
      });

      await ctx.sleep(1, { stepId: "nap" });

      const after = await ctx.step("after", async () => {
        afterRuns += 1;
        return "after";
      });

      return { before, after };
    };

    const service1 = createContextCapturingService({
      store,
      eventBus: new MemoryEventBus(),
      task,
      handler,
    });

    const executionId = await service1.start(task);
    const suspended = await store.getExecution(executionId);

    expect(suspended?.status).toBe(ExecutionStatus.Sleeping);
    expect(beforeRuns).toBe(1);
    expect(afterRuns).toBe(0);

    // "Restart": new service instance with the same store (persistence layer).
    const service2 = createContextCapturingService({
      store,
      eventBus: new MemoryEventBus(),
      task,
      handler,
    });

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers).toHaveLength(1);
    expect(timers[0]?.type).toBe(TimerType.Sleep);

    await service2.handleTimer(timers[0]!);

    const completed = await store.getExecution(executionId);
    expect(completed?.status).toBe(ExecutionStatus.Completed);
    expect(completed?.result).toEqual({ before: "before", after: "after" });
    expect(beforeRuns).toBe(1); // cached across replay
    expect(afterRuns).toBe(1);
  });

  it("retries failed executions and replays completed steps on resume", async () => {
    const store = new MemoryStore();
    const task = r
      .task("durable.tests.crash-recovery.retry")
      .run(async () => "unused")
      .build();

    let beforeRuns = 0;
    let afterRuns = 0;
    let shouldFail = true;

    const handler: WorkflowHandler = async (ctx) => {
      const before = await ctx.step("before", async () => {
        beforeRuns += 1;
        return "before";
      });

      if (shouldFail) {
        shouldFail = false;
        throw new Error("boom");
      }

      const after = await ctx.step("after", async () => {
        afterRuns += 1;
        return "after";
      });

      return { before, after };
    };

    const service1 = createContextCapturingService({
      store,
      eventBus: new MemoryEventBus(),
      task,
      handler,
      execution: { maxAttempts: 2 },
    });

    const executionId = await service1.start(task);
    const retrying = await store.getExecution(executionId);

    expect(retrying?.status).toBe(ExecutionStatus.Retrying);
    expect(retrying?.attempt).toBe(2);
    expect(beforeRuns).toBe(1);
    expect(afterRuns).toBe(0);

    // "Restart": resume by handling the retry timer from a new service instance.
    const service2 = createContextCapturingService({
      store,
      eventBus: new MemoryEventBus(),
      task,
      handler,
      execution: { maxAttempts: 2 },
    });

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers).toHaveLength(1);
    expect(timers[0]?.type).toBe(TimerType.Retry);

    await service2.handleTimer(timers[0]!);

    const completed = await store.getExecution(executionId);
    expect(completed?.status).toBe(ExecutionStatus.Completed);
    expect(completed?.result).toEqual({ before: "before", after: "after" });
    expect(beforeRuns).toBe(1); // "before" step cached across retry
    expect(afterRuns).toBe(1);
  });

  it("recover() resumes running executions without timers", async () => {
    const store = new MemoryStore();
    const executionId = "durable.tests.crash-recovery.recover.exec";

    const task = r
      .task("durable.tests.crash-recovery.recover.task")
      .run(async () => "unused")
      .build();

    let beforeRuns = 0;
    let afterRuns = 0;
    const handler: WorkflowHandler = async (ctx) => {
      const before = await ctx.step("before", async () => {
        beforeRuns += 1;
        return "before";
      });

      const after = await ctx.step("after", async () => {
        afterRuns += 1;
        return "after";
      });

      return { before, after };
    };

    await store.saveExecution({
      id: executionId,
      taskId: task.id,
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.saveStepResult({
      executionId,
      stepId: "before",
      result: "before",
      completedAt: new Date(),
    });

    const service = createContextCapturingService({
      store,
      eventBus: new MemoryEventBus(),
      task,
      handler,
    });

    await service.recover();

    const completed = await store.getExecution(executionId);
    expect(completed?.status).toBe(ExecutionStatus.Completed);
    expect(completed?.result).toEqual({ before: "before", after: "after" });
    expect(beforeRuns).toBe(0); // cached from store
    expect(afterRuns).toBe(1);
  });
});
