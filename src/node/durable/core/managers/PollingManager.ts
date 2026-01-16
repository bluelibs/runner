import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import { DurableAuditEntryKind } from "../audit";
import {
  ExecutionStatus,
  ScheduleStatus,
  TimerType,
  type Execution,
  type Timer,
} from "../types";
import type { AuditLogger } from "./AuditLogger";
import type { TaskRegistry } from "./TaskRegistry";
import type { ScheduleManager } from "./ScheduleManager";
import { parseSignalState, createExecutionId } from "../utils";
import { clearTimeout, setTimeout } from "node:timers";

export interface PollingConfig {
  enabled?: boolean;
  interval?: number;
  claimTtlMs?: number;
}

export interface PollingManagerCallbacks {
  processExecution: (executionId: string) => Promise<void>;
  kickoffExecution: (executionId: string) => Promise<void>;
}

/**
 * Manages timer polling loop for scheduled executions, sleeps, and retries.
 */
export class PollingManager {
  private isRunning = false;
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingWake: (() => void) | null = null;

  constructor(
    private readonly workerId: string,
    private readonly config: PollingConfig,
    private readonly store: IDurableStore,
    private readonly queue: IDurableQueue | undefined,
    private readonly maxAttempts: number,
    private readonly defaultTimeout: number | undefined,
    private readonly taskRegistry: TaskRegistry,
    private readonly auditLogger: AuditLogger,
    private readonly scheduleManager: ScheduleManager,
    private readonly callbacks: PollingManagerCallbacks,
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    void this.poll();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.pollingWake) {
      const wake = this.pollingWake;
      this.pollingWake = null;
      wake();
    }
  }

  private async poll(): Promise<void> {
    const intervalMs = this.config.interval ?? 1000;

    while (this.isRunning) {
      try {
        const ready = await this.store.getReadyTimers();
        for (const timer of ready) {
          await this.handleTimer(timer);
        }
      } catch (error) {
        console.error("DurableService polling error:", error);
      }

      if (!this.isRunning) return;

      await new Promise<void>((resolve) => {
        this.pollingWake = resolve;
        const pollingTimer = setTimeout(() => {
          this.pollingTimer = null;
          this.pollingWake = null;
          resolve();
        }, intervalMs);
        this.pollingTimer = pollingTimer;
        pollingTimer.unref();
      });
    }
  }

  /** @internal - public for testing */
  async handleTimer(timer: Timer): Promise<void> {
    // Distributed timer coordination
    if (this.store.claimTimer) {
      const claimTtlMs = this.config.claimTtlMs ?? 30_000;
      const claimed = await this.store.claimTimer(
        timer.id,
        this.workerId,
        claimTtlMs,
      );
      if (!claimed) {
        return; // Another worker is handling this timer
      }
    }

    try {
      await this.store.markTimerFired(timer.id);

      if (timer.type === TimerType.Sleep && timer.executionId && timer.stepId) {
        await this.store.saveStepResult({
          executionId: timer.executionId,
          stepId: timer.stepId,
          result: { state: "completed" },
          completedAt: new Date(),
        });
        const execution = await this.store.getExecution(timer.executionId);
        const attempt = execution ? execution.attempt : 0;
        await this.auditLogger.log({
          kind: DurableAuditEntryKind.SleepCompleted,
          executionId: timer.executionId,
          taskId: execution?.taskId,
          attempt,
          stepId: timer.stepId,
          timerId: timer.id,
        });
      }

      if (
        timer.type === TimerType.SignalTimeout &&
        timer.executionId &&
        timer.stepId
      ) {
        const existing = await this.store.getStepResult(
          timer.executionId,
          timer.stepId,
        );
        const state = parseSignalState(existing?.result);
        if (state?.state === "waiting") {
          await this.store.saveStepResult({
            executionId: timer.executionId,
            stepId: timer.stepId,
            result: { state: "timed_out" },
            completedAt: new Date(),
          });
          const execution = await this.store.getExecution(timer.executionId);
          const attempt = execution ? execution.attempt : 0;
          const stepSuffix = timer.stepId.startsWith("__signal:")
            ? timer.stepId.slice("__signal:".length)
            : timer.stepId;
          const signalId = stepSuffix.split(":")[0];
          await this.auditLogger.log({
            kind: DurableAuditEntryKind.SignalTimedOut,
            executionId: timer.executionId,
            taskId: execution?.taskId,
            attempt,
            stepId: timer.stepId,
            signalId,
            timerId: timer.id,
          });
        }
      }

      if (timer.executionId) {
        if (this.queue) {
          await this.queue.enqueue({
            type: "resume",
            payload: { executionId: timer.executionId },
            maxAttempts: this.maxAttempts,
          });
        } else {
          await this.callbacks.processExecution(timer.executionId);
        }
        return;
      }

      if (!timer.taskId) return;

      if (timer.scheduleId) {
        const schedule = await this.store.getSchedule(timer.scheduleId);
        // If the schedule no longer exists, or is paused, don't execute.
        if (!schedule || schedule.status !== ScheduleStatus.Active) return;
        // If schedule.nextRun exists, treat mismatched timers as stale (race/updates).
        if (
          schedule.nextRun &&
          timer.fireAt.getTime() !== schedule.nextRun.getTime()
        ) {
          return;
        }
      }

      const task = this.taskRegistry.find(timer.taskId);
      if (!task) return;

      const executionId = createExecutionId();
      const execution: Execution<unknown, unknown> = {
        id: executionId,
        taskId: task.id,
        input: timer.input,
        status: ExecutionStatus.Pending,
        attempt: 1,
        maxAttempts: this.maxAttempts,
        timeout: this.defaultTimeout,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.store.saveExecution(execution);
      await this.callbacks.kickoffExecution(executionId);

      if (timer.scheduleId) {
        const schedule = await this.store.getSchedule(timer.scheduleId);
        if (schedule && schedule.status === ScheduleStatus.Active) {
          await this.scheduleManager.reschedule(schedule, {
            lastRunAt: new Date(),
          });
        }
      }
    } finally {
      try {
        await this.store.deleteTimer(timer.id);
      } catch {
        // best-effort cleanup; ignore
      }
    }
  }
}
