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
import {
  deleteSignalWaiter,
  getSignalIdFromStepId,
  withSignalLock,
} from "../signalWaiters";
import { Logger } from "../../../../models/Logger";
import { durableExecutionInvariantError } from "../../../../errors";

export interface PollingConfig {
  enabled?: boolean;
  interval?: number;
  claimTtlMs?: number;
}

export interface PollingManagerCallbacks {
  processExecution: (executionId: string) => Promise<void>;
  kickoffExecution: (executionId: string) => Promise<void>;
}

interface TimerClaimState {
  lossError: Error | null;
}

/**
 * Timer/tick driver for durable workflows.
 *
 * The durable store is the source of truth, but time needs an active driver:
 * `PollingManager` periodically scans ready timers and performs the appropriate action:
 *
 * - complete `sleep()` steps by marking their step result as completed
 * - resume executions after signal timeouts / scheduled kickoffs / retries
 * - coordinate multi-worker polling via optional `store.claimTimer(...)`
 *
 * In production topologies you typically enable polling on worker nodes only.
 */
export class PollingManager {
  private isRunning = false;
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingWake: (() => void) | null = null;
  private readonly logger: Logger;

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
    logger?: Logger,
  ) {
    const baseLogger =
      logger ??
      new Logger({
        printThreshold: "error",
        printStrategy: "pretty",
        bufferLogs: false,
      });
    this.logger = baseLogger.with({ source: "durable.polling" });
  }

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
        await Promise.allSettled(ready.map((timer) => this.handleTimer(timer)));
      } catch (error) {
        try {
          await this.logger.error("Durable polling loop failed.", { error });
        } catch {
          // Logging must not crash durable polling loops.
        }
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
    let stopClaimHeartbeat = () => {};
    let timerClaimState: TimerClaimState | null = null;
    let finalizeTimerOnError = false;

    const assertTimerClaimIsStillOwned = (): void => {
      if (timerClaimState?.lossError) {
        throw timerClaimState.lossError;
      }
    };

    const finalizeTimer = async (): Promise<void> => {
      await this.store.markTimerFired(timer.id);
      await this.store.deleteTimer(timer.id);
    };

    // Distributed timer coordination. Failures must not drop timers (at-least-once).
    if (this.store.claimTimer) {
      const defaultClaimTtlMs = this.queue ? 5_000 : 30_000;
      const claimTtlMs = this.config.claimTtlMs ?? defaultClaimTtlMs;
      const claimed = await this.store.claimTimer(
        timer.id,
        this.workerId,
        claimTtlMs,
      );
      if (!claimed) return; // Another worker is handling this timer

      timerClaimState = { lossError: null };
      stopClaimHeartbeat = this.startTimerClaimHeartbeat(
        timer.id,
        claimTtlMs,
        timerClaimState,
      );
    }

    try {
      assertTimerClaimIsStillOwned();

      if (timer.type === TimerType.Sleep && timer.executionId && timer.stepId) {
        await this.store.saveStepResult({
          executionId: timer.executionId,
          stepId: timer.stepId,
          result: { state: "completed" },
          completedAt: new Date(),
        });
        finalizeTimerOnError = true;
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

      assertTimerClaimIsStillOwned();

      if (
        timer.type === TimerType.SignalTimeout &&
        timer.executionId &&
        timer.stepId
      ) {
        const fallbackSignalId = timer.stepId.startsWith("__signal:")
          ? getSignalIdFromStepId(timer.stepId)
          : timer.stepId.split(":")[0];
        const currentSignalStep = await this.store.getStepResult(
          timer.executionId,
          timer.stepId,
        );
        const currentSignalState = parseSignalState(currentSignalStep?.result);
        const signalIdForLock =
          currentSignalState?.signalId ?? fallbackSignalId;
        const lockSignalId = signalIdForLock ?? "__unknown_signal_timeout__";

        if (!signalIdForLock) {
          try {
            await this.logger.warn(
              "Durable signal-timeout handler fell back to an unknown signal id.",
              {
                data: {
                  timerId: timer.id,
                  executionId: timer.executionId,
                  stepId: timer.stepId,
                  fallbackSignalId: lockSignalId,
                  timerType: timer.type,
                },
              },
            );
          } catch {
            // Logging must not crash durable timer handling.
          }
        }

        const persistedSignalId = await withSignalLock({
          store: this.store,
          executionId: timer.executionId,
          signalId: lockSignalId,
          fn: async () => {
            const existing = await this.store.getStepResult(
              timer.executionId!,
              timer.stepId!,
            );
            const state = parseSignalState(existing?.result);
            if (state?.state !== "waiting") return null;

            const signalId = state.signalId ?? fallbackSignalId;
            if (!signalId) {
              return durableExecutionInvariantError.throw({
                message: `Invalid signal timeout step id '${timer.stepId}' for timer '${timer.id}'`,
              });
            }

            await deleteSignalWaiter({
              store: this.store,
              executionId: timer.executionId!,
              signalId,
              stepId: timer.stepId!,
            });

            const timedOutState =
              state.signalId !== undefined
                ? { state: "timed_out" as const, signalId: state.signalId }
                : { state: "timed_out" as const };
            await this.store.saveStepResult({
              executionId: timer.executionId!,
              stepId: timer.stepId!,
              result: timedOutState,
              completedAt: new Date(),
            });

            return signalId;
          },
        });

        if (persistedSignalId) {
          finalizeTimerOnError = true;
          const execution = await this.store.getExecution(timer.executionId);
          const attempt = execution ? execution.attempt : 0;
          await this.auditLogger.log({
            kind: DurableAuditEntryKind.SignalTimedOut,
            executionId: timer.executionId,
            taskId: execution?.taskId,
            attempt,
            stepId: timer.stepId,
            signalId: persistedSignalId,
            timerId: timer.id,
          });
        }
      }

      assertTimerClaimIsStillOwned();

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

        finalizeTimerOnError = true;
        assertTimerClaimIsStillOwned();
        await finalizeTimer();
        return;
      }

      if (!timer.taskId) {
        await finalizeTimer();
        return;
      }

      if (timer.scheduleId) {
        const schedule = await this.store.getSchedule(timer.scheduleId);
        assertTimerClaimIsStillOwned();
        // If the schedule no longer exists, or is paused, don't execute.
        if (!schedule || schedule.status !== ScheduleStatus.Active) {
          await finalizeTimer();
          return;
        }
        // If schedule.nextRun exists, treat mismatched timers as stale (race/updates).
        if (
          schedule.nextRun &&
          timer.fireAt.getTime() !== schedule.nextRun.getTime()
        ) {
          await finalizeTimer();
          return;
        }
      }

      assertTimerClaimIsStillOwned();
      const task = this.taskRegistry.find(timer.taskId);
      if (!task) {
        await finalizeTimer();
        return;
      }

      const persistedTaskId = this.taskRegistry.getPersistenceId(task);
      const executionId = await this.persistTaskTimerExecution({
        timer,
        taskId: persistedTaskId,
      });
      finalizeTimerOnError = true;
      assertTimerClaimIsStillOwned();
      await this.callbacks.kickoffExecution(executionId);
      assertTimerClaimIsStillOwned();

      if (timer.scheduleId) {
        const schedule = await this.store.getSchedule(timer.scheduleId);
        assertTimerClaimIsStillOwned();
        if (schedule && schedule.status === ScheduleStatus.Active) {
          await this.scheduleManager.reschedule(schedule, {
            lastRunAt: new Date(),
          });
          assertTimerClaimIsStillOwned();
        }
      }

      await finalizeTimer();
    } catch (error) {
      let cleanupError: unknown = null;
      if (finalizeTimerOnError) {
        try {
          await finalizeTimer();
        } catch (finalizeError) {
          cleanupError = finalizeError;
        }
      }

      // Keep the timer pending so it can be retried by the poller.
      try {
        await this.logger.error("Durable timer handling failed.", {
          error,
          data: {
            timerId: timer.id,
            timerType: timer.type,
            executionId: timer.executionId,
            taskId: timer.taskId,
            scheduleId: timer.scheduleId,
            finalizeTimerOnError,
            cleanupError,
          },
        });
      } catch {
        // Logging must not crash durable timer retry loops.
      }
    } finally {
      stopClaimHeartbeat();
    }
  }

  private async persistTaskTimerExecution(params: {
    timer: Timer;
    taskId: string;
  }): Promise<string> {
    const executionId = createExecutionId();
    const execution: Execution<unknown, unknown> = {
      id: executionId,
      taskId: params.taskId,
      input: params.timer.input,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: this.maxAttempts,
      timeout: this.defaultTimeout,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.store.createExecutionWithIdempotencyKey) {
      // A claimed timer may be retried after partial progress, so its durable
      // execution must stay stable across retries to avoid duplicate runs.
      const created = await this.store.createExecutionWithIdempotencyKey({
        execution,
        taskId: params.taskId,
        idempotencyKey: `timer:${params.timer.id}`,
      });
      return created.executionId;
    }

    await this.store.saveExecution(execution);
    return executionId;
  }

  private startTimerClaimHeartbeat(
    timerId: string,
    claimTtlMs: number,
    claimState: TimerClaimState,
  ): () => void {
    if (!this.store.renewTimerClaim) {
      return () => {};
    }

    const intervalMs = Math.max(1_000, Math.floor(claimTtlMs / 3));
    let stopped = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

    const loseClaim = (message: string) => {
      if (claimState.lossError) return;
      claimState.lossError = durableExecutionInvariantError.new({ message });
      stopped = true;
    };

    const tick = () => {
      if (stopped) return;

      heartbeatTimer = setTimeout(() => {
        heartbeatTimer = null;
        if (stopped) return;
        void this.store.renewTimerClaim!(timerId, this.workerId, claimTtlMs)
          .then((renewed) => {
            if (!renewed) {
              loseClaim(
                `Timer claim lost for '${timerId}' while worker '${this.workerId}' was still handling it.`,
              );
            }
          })
          .catch(async (error) => {
            loseClaim(
              `Timer-claim heartbeat failed for '${timerId}' while worker '${this.workerId}' was still handling it.`,
            );
            try {
              await this.logger.error("Durable timer-claim heartbeat failed.", {
                error,
                data: { timerId, workerId: this.workerId },
              });
            } catch {
              // Logging must not crash timer-claim heartbeat loops.
            }
          })
          .finally(() => {
            tick();
          });
      }, intervalMs);

      heartbeatTimer.unref?.();
    };

    tick();

    return () => {
      stopped = true;
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
    };
  }
}
