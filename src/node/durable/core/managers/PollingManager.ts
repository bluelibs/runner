import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import { DurableAuditEntryKind } from "../audit";
import { TimerType, type Timer } from "../types";
import type { AuditLogger } from "./AuditLogger";
import type { TaskRegistry } from "./TaskRegistry";
import type { ScheduleManager } from "./ScheduleManager";
import {
  handleExecutionWaitTimeoutTimer,
  handleExecutionTimer,
  handleScheduledTaskTimer,
  handleSignalTimeoutTimer,
  handleSleepTimer,
  persistTaskTimerExecution,
} from "./PollingManager.timerHandlers";
import {
  startTimerClaimHeartbeat,
  type TimerClaimState,
} from "./PollingManager.timerHeartbeat";
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
  private readonly inFlightTimers = new Set<Promise<void>>();
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

  async cooldown(): Promise<void> {
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

  async stop(): Promise<void> {
    await this.cooldown();
    await this.waitForInFlightTimers();
  }

  private async poll(): Promise<void> {
    const intervalMs = this.config.interval ?? 1000;

    while (this.isRunning) {
      try {
        const ready = await this.store.getReadyTimers();
        await Promise.allSettled(
          ready.map((timer) =>
            this.trackInFlightTimer(this.handleTimer(timer)),
          ),
        );
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
    let safeToFinalizeCurrentTimer = false;

    const assertTimerClaimIsStillOwned = (): void => {
      if (timerClaimState?.lossError) {
        throw timerClaimState.lossError;
      }
    };

    const finalizeTimer = async (): Promise<void> => {
      if (this.store.finalizeClaimedTimer && timerClaimState) {
        const finalized = await this.store.finalizeClaimedTimer(
          timer.id,
          this.workerId,
        );
        if (!finalized) {
          assertTimerClaimIsStillOwned();
          throw durableExecutionInvariantError.new({
            message: `Timer claim lost for '${timer.id}' before finalization could be committed.`,
          });
        }
        return;
      }

      await this.store.markTimerFired(timer.id);
      await this.store.deleteTimer(timer.id);
    };

    const releaseTimerClaim = async (): Promise<void> => {
      if (!timerClaimState) {
        return;
      }

      if (!this.store.releaseTimerClaim) {
        throw durableExecutionInvariantError.new({
          message: `Store must implement releaseTimerClaim() when recurring timers are claimed for '${timer.id}'.`,
        });
      }

      const currentClaimState = timerClaimState;
      stopClaimHeartbeat();
      stopClaimHeartbeat = () => {};
      timerClaimState = null;

      const released = await this.store.releaseTimerClaim(
        timer.id,
        this.workerId,
      );
      if (!released) {
        throw (
          currentClaimState.lossError ??
          durableExecutionInvariantError.new({
            message: `Timer claim lost for '${timer.id}' before claim release could be committed.`,
          })
        );
      }
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
        await handleSleepTimer({
          store: this.store,
          auditLogger: this.auditLogger,
          timer,
        });
        safeToFinalizeCurrentTimer = true;
      }

      assertTimerClaimIsStillOwned();

      if (
        timer.type === TimerType.Timeout &&
        timer.executionId &&
        timer.stepId
      ) {
        if (
          await handleExecutionWaitTimeoutTimer({
            store: this.store,
            timer,
          })
        ) {
          safeToFinalizeCurrentTimer = true;
        }
      }

      assertTimerClaimIsStillOwned();

      if (
        timer.type === TimerType.SignalTimeout &&
        timer.executionId &&
        timer.stepId
      ) {
        const persistedSignalId = await handleSignalTimeoutTimer({
          store: this.store,
          logger: this.logger,
          timer,
        });

        if (persistedSignalId) {
          safeToFinalizeCurrentTimer = true;
          const execution = await this.store.getExecution(timer.executionId);
          const attempt = execution ? execution.attempt : 0;
          await this.auditLogger.log({
            kind: DurableAuditEntryKind.SignalTimedOut,
            executionId: timer.executionId,
            workflowKey: execution?.workflowKey,
            attempt,
            stepId: timer.stepId,
            signalId: persistedSignalId,
            timerId: timer.id,
          });
        }
      }

      assertTimerClaimIsStillOwned();

      if (
        await handleExecutionTimer({
          timer,
          queue: this.queue,
          maxAttempts: this.maxAttempts,
          processExecution: this.callbacks.processExecution,
          onSafeToFinalizeCurrentTimer: () => {
            safeToFinalizeCurrentTimer = true;
          },
        })
      ) {
        assertTimerClaimIsStillOwned();
        await finalizeTimer();
        return;
      }

      const scheduledTimerResult = await handleScheduledTaskTimer({
        store: this.store,
        timer,
        taskRegistry: this.taskRegistry,
        scheduleManager: this.scheduleManager,
        kickoffExecution: this.callbacks.kickoffExecution,
        persistTaskTimerExecution: (params) =>
          this.persistTaskTimerExecution(params),
        assertTimerClaimIsStillOwned,
        onSafeToFinalizeCurrentTimer: () => {
          safeToFinalizeCurrentTimer = true;
        },
      });
      if (!scheduledTimerResult.handled) {
        await finalizeTimer();
        return;
      }

      if (scheduledTimerResult.finalizeCurrentTimer) {
        await finalizeTimer();
        return;
      }

      await releaseTimerClaim();
      return;
    } catch (error) {
      let cleanupError: unknown = null;
      if (safeToFinalizeCurrentTimer) {
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
            workflowKey: timer.workflowKey,
            scheduleId: timer.scheduleId,
            safeToFinalizeCurrentTimer,
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
    workflowKey: string;
  }): Promise<string> {
    return await persistTaskTimerExecution({
      store: this.store,
      timer: params.timer,
      workflowKey: params.workflowKey,
      maxAttempts: this.maxAttempts,
      defaultTimeout: this.defaultTimeout,
    });
  }

  private startTimerClaimHeartbeat(
    timerId: string,
    claimTtlMs: number,
    claimState: TimerClaimState,
  ): () => void {
    return startTimerClaimHeartbeat({
      store: this.store,
      logger: this.logger,
      workerId: this.workerId,
      timerId,
      claimTtlMs,
      claimState,
    });
  }

  private trackInFlightTimer(handling: Promise<void>): Promise<void> {
    this.inFlightTimers.add(handling);
    void handling.finally(() => {
      this.inFlightTimers.delete(handling);
    });
    return handling;
  }

  private async waitForInFlightTimers(): Promise<void> {
    while (this.inFlightTimers.size > 0) {
      await Promise.allSettled([...this.inFlightTimers]);
    }
  }
}
