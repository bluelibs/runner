import { DurableService } from "../../../durable/core/DurableService";
import { DurableContext } from "../../../durable/core/DurableContext";
import { ClusterRecovery } from "../../../durable/core/managers/ClusterRecovery";
import {
  createExecutionLockState,
  markExecutionLockLost,
} from "../../../durable/core/managers/ExecutionManager.locking";
import { runDurableStepAttempts } from "../../../durable/core/durable-context/DurableContext.stepAttempt";
import { saveStepRetryCount } from "../../../durable/core/durable-context/DurableContext.stepRetryState";
import { EXECUTION_PAUSED_ABORT_REASON } from "../../../durable/core/pauseInterruption";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { MemoryEventBus } from "../../../durable/bus/MemoryEventBus";
import {
  ExecutionStatus,
  TimerType,
  type Execution,
} from "../../../durable/core/types";
import { Logger } from "../../../../models/Logger";
import { cancellationError } from "../../../../errors";
import { commandFixture } from "./managers/command.helpers";

const silentLogger = () =>
  new Logger({
    printThreshold: null,
    printStrategy: "pretty",
    bufferLogs: false,
  });

describe("durable: PR #158 hardening and scalability regressions", () => {
  it("preserves unversioned scheduled timers on workers without that workflow", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      tasks: [],
      timers: { enabled: false },
    });
    try {
      const fireAt = new Date(Date.now() - 1_000);
      await store.createSchedule({
        id: "sched-unversioned",
        workflowKey: "other-service.workflow",
        type: "interval",
        pattern: "1000",
        input: undefined,
        status: "active",
        nextRun: fireAt,
        createdAt: fireAt,
        updatedAt: fireAt,
      });
      const timer = {
        id: "sched:sched-unversioned",
        scheduleId: "sched-unversioned",
        workflowKey: "other-service.workflow",
        type: TimerType.Scheduled,
        fireAt,
        status: "pending" as const,
      };
      await store.createTimer(timer);
      await service.handleTimer(timer);
      const remaining = await store.getReadyTimers(
        new Date(Date.now() + 60_000),
      );
      expect(remaining.map((t) => t.id)).toContain(timer.id);
    } finally {
      await service.stop();
    }
  });

  it("retries command commit when a benign current/updatedAt write races commit", async () => {
    const f = await commandFixture();
    await f.enqueue("benign-race");
    const realComplete = f.store.completeCommand.bind(f.store);
    let first = true;
    jest
      .spyOn(f.store, "completeCommand")
      .mockImplementation(async (cmd, expected) => {
        if (first && cmd.status === "completed") {
          first = false;
          await f.store.updateExecution(f.execution.id, {
            current: undefined,
            updatedAt: new Date(Date.now() + 5_000),
          });
          return false;
        }
        return realComplete(cmd, expected);
      });
    await f.manager.drain(f.execution, f.workflow, f.store, f.lock);
    expect((await f.store.getCommand("benign-race"))?.status).toBe("completed");
  });

  it("forwards command admission across a concurrent continueAsNew transition", async () => {
    const f = await commandFixture();
    const successor: Execution = {
      ...f.execution,
      id: "run-2",
      continuedFromExecutionId: f.execution.id,
    };
    await f.store.saveExecution(successor);
    const realEnqueue = f.store.enqueueCommand.bind(f.store);
    let raced = false;
    jest.spyOn(f.store, "enqueueCommand").mockImplementation(async (rec) => {
      if (!raced && rec.executionId === f.execution.id) {
        raced = true;
        await f.store.saveExecution({
          ...f.execution,
          status: ExecutionStatus.ContinuedAsNew,
          continuedAsExecutionId: successor.id,
        });
      }
      return realEnqueue(rec);
    });
    const waitPromise = f.manager.command(
      f.execution.id,
      f.command,
      undefined,
      {
        idempotencyKey: "forward-key",
        waitTimeoutMs: 5_000,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const head = await f.store.getNextCommand(successor.id);
    expect(head?.executionId).toBe(successor.id);
    await f.store.completeCommand(
      {
        ...head!,
        status: "completed",
        result: "forwarded",
        completedAt: new Date(),
      },
      successor,
    );
    await expect(waitPromise).resolves.toBe("forwarded");
  });

  it("does not mark execution CompensationFailed when rollback is interrupted by shutdown or lock loss", async () => {
    const store = new MemoryStore();
    const now = new Date();
    const exec: Execution = {
      id: "rb-shutdown",
      workflowKey: "wf",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    };
    await store.saveExecution(exec);
    const lockState = createExecutionLockState();
    const shutdownReason = "Runtime shutdown aborting";
    const ctx = new DurableContext(store, new MemoryEventBus(), exec.id, 1, {
      executionLockState: lockState,
      getShutdownInterruptionReason: () => shutdownReason,
    });
    await ctx
      .step("s1")
      .up(async () => "ok")
      .down(async () => {
        throw cancellationError.new({ reason: shutdownReason });
      });
    await expect(ctx.rollback()).rejects.toThrow(shutdownReason);
    expect((await store.getExecution(exec.id))?.status).toBe(
      ExecutionStatus.Running,
    );

    const ctx2 = new DurableContext(store, new MemoryEventBus(), exec.id, 1, {
      executionLockState: lockState,
    });
    await ctx2
      .step("s2")
      .up(async () => "ok")
      .down(async () => {
        throw markExecutionLockLost(lockState, `execution:${exec.id}`);
      });
    await expect(ctx2.rollback()).rejects.toThrow(/lock lost/i);
    expect((await store.getExecution(exec.id))?.status).toBe(
      ExecutionStatus.Running,
    );
  });

  it("aborts late attempt cancellation registration after shutdown and keeps polling on shared store + MemoryEventBus", async () => {
    const sharedStore = Object.assign(new MemoryStore(), {
      isSharedAcrossProcesses: true,
    });
    const service = new DurableService({
      store: sharedStore,
      eventBus: new MemoryEventBus(),
      tasks: [],
      timers: { enabled: false },
    });
    const controller = (service as any).executionManager.cancellation;
    expect(controller.deps.liveCancellationEventBus).toBeNull();
    controller.interruptActiveAttempts("shutdown-now");
    const late = await controller.registerAttemptCancellation({
      executionId: "late-1",
    });
    expect(late.signal.aborted).toBe(true);
    expect(late.signal.reason).toBe("shutdown-now");
    late.stop();
    await service.stop();
  });

  it("interrupts step retry backoff immediately on pause, cancellation, and lock loss", async () => {
    const store = new MemoryStore();
    const base = {
      store,
      executionId: "step-backoff",
      workflowAttempt: 1,
      stepId: "s",
      concurrency: undefined,
      options: { retries: 2 },
      assertCanContinue: async () => {},
    };
    const abortCtrl = new AbortController();
    let runs = 0;
    const lock1 = createExecutionLockState();
    const p1 = runDurableStepAttempts({
      ...base,
      signal: abortCtrl.signal,
      lockState: lock1,
      upFn: async () => {
        runs += 1;
        setTimeout(() => abortCtrl.abort(EXECUTION_PAUSED_ABORT_REASON), 10);
        throw new Error("boom");
      },
    });
    await expect(p1).rejects.toThrow(/paused/i);
    expect(runs).toBe(1);

    // Pre-aborted with normal cancel + pre-lost lock during resumed retry backoff
    const preCancel = new AbortController();
    preCancel.abort("user-cancel");
    await saveStepRetryCount({
      store,
      executionId: "step-backoff-2",
      stepId: "s2",
      workflowAttempt: 1,
      count: 1,
      nextAttemptAtMs: Date.now() + 60_000,
    });
    await expect(
      runDurableStepAttempts({
        ...base,
        executionId: "step-backoff-2",
        stepId: "s2",
        signal: preCancel.signal,
        lockState: createExecutionLockState(),
        upFn: async () => "ok",
      }),
    ).rejects.toThrow(/user-cancel/);

    const lostLock = createExecutionLockState();
    markExecutionLockLost(lostLock, "execution:step-backoff-2");
    await expect(
      runDurableStepAttempts({
        ...base,
        executionId: "step-backoff-2",
        stepId: "s2",
        signal: new AbortController().signal,
        lockState: lostLock,
        upFn: async () => "ok",
      }),
    ).rejects.toThrow(/lock lost/i);
  });

  it("drains full ClusterRecovery pages with bounded concurrency and skips sweep when full", async () => {
    const store = new MemoryStore();
    const now = new Date();
    for (const id of ["c1", "c2", "c3"]) {
      await store.saveExecution({
        id,
        workflowKey: "wf",
        input: undefined,
        status: ExecutionStatus.Pending,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(now.getTime() + Number(id[1])),
        updatedAt: now,
      });
    }
    const recovered: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const recovery = new ClusterRecovery(
      store,
      { enabled: true, batchSize: 10, concurrency: 1, intervalMs: 60_000 },
      async (id) => {
        recovered.push(id);
        if (recovered.length === 1) await firstBlocked;
      },
      () => true,
      silentLogger(),
    );
    const sweep1 = (recovery as any).sweep();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // While concurrency=1 is occupied, a concurrent sweep returns immediately.
    await (recovery as any).sweep();
    releaseFirst();
    await sweep1;
    await Promise.all((recovery as any).inFlight.values());
    await recovery.stop();
    expect(recovered.sort()).toEqual(["c1", "c2", "c3"]);

    // Stopping while waiting on concurrency slot exits the sweep early.
    const stopStore = new MemoryStore();
    for (const id of ["s1", "s2"]) {
      await stopStore.saveExecution({
        id,
        workflowKey: "wf",
        input: undefined,
        status: ExecutionStatus.Pending,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(now.getTime() + Number(id[1])),
        updatedAt: now,
      });
    }
    let releaseBlocked!: () => void;
    const stopRecovery = new ClusterRecovery(
      stopStore,
      { enabled: true, batchSize: 10, concurrency: 1, intervalMs: 60_000 },
      async () => {
        await new Promise<void>((resolve) => {
          releaseBlocked = resolve;
        });
      },
      () => true,
      silentLogger(),
    );
    const stopSweep = (stopRecovery as any).sweep();
    await new Promise((resolve) => setTimeout(resolve, 10));
    stopRecovery.cooldown();
    releaseBlocked();
    await stopSweep;
    await stopRecovery.stop();
  });
});
