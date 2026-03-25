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
  concurrency?: number;
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
 * `PollingManager` periodically claims ready timers and performs the
 * appropriate action:
 *
 * - complete `sleep()` steps by marking their step result as completed
 * - resume executions after signal timeouts / scheduled kickoffs / retries
 * - coordinate multi-worker polling via bounded `store.claimReadyTimers(...)`
 *   plus per-timer claim renewal/finalization
 *
 * In production topologies you typically enable polling on worker nodes only.
 */
export class PollingManager {
  private readonly inFlightTimers = new Set<Promise<void>>();
  private isRunning = false;
  private pollRequested = false;
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
    this.assertClaimBasedPollingSupport();
    this.getPollingIntervalMs();
    this.getConcurrency();
    this.getClaimTtlMs();
    this.isRunning = true;
    this.pollRequested = false;
    void this.poll();
  }

  async cooldown(): Promise<void> {
    this.isRunning = false;
    this.wakePollingLoop();
  }

  async stop(): Promise<void> {
    await this.cooldown();
    await this.waitForInFlightTimers();
  }

  private async poll(): Promise<void> {
    const intervalMs = this.getPollingIntervalMs();

    while (this.isRunning) {
      try {
        await this.fillAvailableTimerSlots();
      } catch (error) {
        try {
          await this.logger.error("Durable polling loop failed.", { error });
        } catch {
          // Logging must not crash durable polling loops.
        }
      }

      if (!this.isRunning) return;

      await this.waitForPollingWake(intervalMs);
    }
  }

  /** @internal - public for testing */
  async handleTimer(timer: Timer): Promise<void> {
    return await this.handleTimerInternal(timer, false);
  }

  private async handleClaimedTimer(timer: Timer): Promise<void> {
    return await this.handleTimerInternal(timer, true);
  }

  private async handleTimerInternal(
    timer: Timer,
    alreadyClaimed: boolean,
  ): Promise<void> {
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
    if (alreadyClaimed) {
      const claimTtlMs = this.getClaimTtlMs();
      timerClaimState = { lossError: null };
      stopClaimHeartbeat = this.startTimerClaimHeartbeat(
        timer.id,
        claimTtlMs,
        timerClaimState,
      );
    } else if (this.store.claimTimer) {
      const claimTtlMs = this.getClaimTtlMs();
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
        const completedSleep = await handleSleepTimer({
          store: this.store,
          auditLogger: this.auditLogger,
          timer,
        });
        safeToFinalizeCurrentTimer = true;
        if (!completedSleep) {
          await finalizeTimer();
          return;
        }
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

  private getConcurrency(): number {
    return this.getPositiveIntegerConfig("polling.concurrency", {
      configuredValue: this.config.concurrency,
      defaultValue: 10,
    });
  }

  private getClaimTtlMs(): number {
    const defaultClaimTtlMs = this.queue ? 5_000 : 30_000;
    return this.getPositiveIntegerConfig("polling.claimTtlMs", {
      configuredValue: this.config.claimTtlMs,
      defaultValue: defaultClaimTtlMs,
    });
  }

  private getPollingIntervalMs(): number {
    return this.getPositiveIntegerConfig("polling.interval", {
      configuredValue: this.config.interval,
      defaultValue: 1_000,
    });
  }

  private getPositiveIntegerConfig(
    configName:
      | "polling.interval"
      | "polling.concurrency"
      | "polling.claimTtlMs",
    params: {
      configuredValue: number | undefined;
      defaultValue: number;
    },
  ): number {
    const value = params.configuredValue ?? params.defaultValue;
    if (!Number.isInteger(value) || value <= 0) {
      durableExecutionInvariantError.throw({
        message: `${configName} must be a positive integer. Received ${String(value)}.`,
      });
    }

    return value;
  }

  private assertClaimBasedPollingSupport(): void {
    if (typeof this.store.claimReadyTimers !== "function") {
      durableExecutionInvariantError.throw({
        message:
          "Durable polling requires store.claimReadyTimers() so ready timers can be claimed with bounded concurrency.",
      });
    }
  }

  private async fillAvailableTimerSlots(): Promise<void> {
    const availableSlots = Math.max(
      0,
      this.getConcurrency() - this.inFlightTimers.size,
    );

    if (availableSlots === 0) {
      return;
    }

    const claimedTimers = await this.store.claimReadyTimers(
      new Date(),
      availableSlots,
      this.workerId,
      this.getClaimTtlMs(),
    );

    claimedTimers.forEach((timer) => {
      this.trackInFlightTimer(this.handleClaimedTimer(timer));
    });
  }

  private wakePollingLoop(): void {
    this.pollRequested = true;

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

  private async waitForPollingWake(intervalMs: number): Promise<void> {
    if (this.pollRequested) {
      this.pollRequested = false;
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        this.pollRequested = false;
        this.pollingTimer = null;
        this.pollingWake = null;
        resolve();
      };

      this.pollingWake = finish;
      const pollingTimer = setTimeout(finish, intervalMs);
      this.pollingTimer = pollingTimer;
      pollingTimer.unref();
    });
  }

  private trackInFlightTimer(handling: Promise<void>): Promise<void> {
    this.inFlightTimers.add(handling);
    void handling.finally(() => {
      this.inFlightTimers.delete(handling);
      if (this.isRunning) {
        this.wakePollingLoop();
      }
    });
    return handling;
  }

  private async waitForInFlightTimers(): Promise<void> {
    while (this.inFlightTimers.size > 0) {
      await Promise.allSettled([...this.inFlightTimers]);
    }
  }
}
