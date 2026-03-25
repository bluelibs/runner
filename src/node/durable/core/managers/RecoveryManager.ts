import { durableExecutionInvariantError } from "../../../../errors";
import { Semaphore } from "../../../../models/Semaphore";
import type {
  RecoverFailureReportType,
  RecoverRecoveredReportType,
  RecoverReportType,
  RecoverSkippedReasonType,
  RecoverSkippedReportType,
} from "../interfaces/service";
import type { IDurableStore } from "../interfaces/store";
import { acquireStoreLock } from "../locking";
import { ExecutionStatus, TimerType } from "../types";
import { sleepMs } from "../utils";
import type { Logger } from "../../../../models/Logger";
import type { ExecutionManager } from "./ExecutionManager";

export interface RecoveryManagerConfig {
  onStartup?: boolean;
  concurrency?: number;
  claimTtlMs?: number;
}

type RecoveryClaimedOutcome =
  | { kind: "recovered" }
  | { kind: "failed"; errorMessage: string };

type RecoverabilityDecision =
  | { kind: "recover" }
  | { kind: "skip"; reason: RecoverSkippedReasonType };

type RecoverableExecution = {
  id: string;
  status: ExecutionStatus;
};

type RecoveryClaimState = {
  lost: boolean;
  lossError: Error;
  waitForLoss: Promise<never>;
  markLost: () => void;
};

/**
 * Coordinates durable orphan recovery both for manual `recover()` calls and
 * for background worker startup drains.
 */
export class RecoveryManager {
  private backgroundRecoveryPromise: Promise<void> | null = null;
  private backgroundRecoveryController: AbortController | null = null;

  constructor(
    private readonly store: IDurableStore,
    private readonly executionManager: ExecutionManager,
    private readonly logger: Logger,
    private readonly config: RecoveryManagerConfig = {},
  ) {}

  recover(): Promise<RecoverReportType> {
    this.assertRecoveryLockingSupported();
    return this.runDrain();
  }

  startBackgroundRecovery(): void {
    this.assertRecoveryLockingSupported();
    if (this.backgroundRecoveryPromise !== null) return;

    const controller = new AbortController();
    this.backgroundRecoveryController = controller;
    this.backgroundRecoveryPromise = this.runDrain(controller.signal)
      .then(() => undefined)
      .catch(async (error) => {
        try {
          await this.logger.error("Durable startup recovery failed.", {
            error,
          });
        } catch {
          // Logging must not crash recovery background tasks.
        }
      })
      .finally(() => {
        this.backgroundRecoveryController = null;
        this.backgroundRecoveryPromise = null;
      });
  }

  cooldownBackgroundRecovery(): void {
    this.backgroundRecoveryController?.abort();
  }

  async stopBackgroundRecovery(): Promise<void> {
    this.cooldownBackgroundRecovery();
    await this.backgroundRecoveryPromise;
  }

  private assertRecoveryLockingSupported(): void {
    if (!this.store.acquireLock || !this.store.releaseLock) {
      durableExecutionInvariantError.throw({
        message:
          "Durable recovery requires store-level locking. Implement acquireLock() and releaseLock() on the durable store.",
      });
    }
  }

  private async runDrain(signal?: AbortSignal): Promise<RecoverReportType> {
    const semaphore = new Semaphore(this.config.concurrency ?? 10);
    const seenExecutionIds = new Set<string>();
    const recovered = new Map<string, RecoverRecoveredReportType>();
    const skipped = new Map<string, RecoverSkippedReportType>();
    const failures = new Map<string, RecoverFailureReportType>();
    const attemptedExecutionIds = new Set<string>();
    const claimElsewhere = new Map<string, RecoverSkippedReportType>();

    while (!signal?.aborted) {
      const incomplete = await this.store.listIncompleteExecutions();
      const pendingTimerTypesByExecutionId =
        await this.getPendingTimerTypesByExecutionId();
      let claimedInPass = 0;

      await Promise.all(
        incomplete.map((execution) =>
          this.withRecoveryPermit(semaphore, signal, async () => {
            if (signal?.aborted) return;
            if (attemptedExecutionIds.has(execution.id)) return;

            seenExecutionIds.add(execution.id);
            const decision = this.getRecoverabilityDecision(
              execution,
              pendingTimerTypesByExecutionId,
            );

            if (decision.kind === "skip") {
              skipped.set(execution.id, {
                executionId: execution.id,
                status: execution.status,
                reason: decision.reason,
              });
              return;
            }

            const claimedOutcome = await this.tryRecoverExecution(
              execution,
              signal,
            );

            if (claimedOutcome === null) {
              claimElsewhere.set(execution.id, {
                executionId: execution.id,
                status: execution.status,
                reason: "claimed_elsewhere",
              });
              return;
            }

            attemptedExecutionIds.add(execution.id);
            claimedInPass += 1;
            skipped.delete(execution.id);
            claimElsewhere.delete(execution.id);

            if (claimedOutcome.kind === "recovered") {
              recovered.set(execution.id, {
                executionId: execution.id,
                status: execution.status,
              });
              failures.delete(execution.id);
              return;
            }

            failures.set(execution.id, {
              executionId: execution.id,
              status: execution.status,
              errorMessage: claimedOutcome.errorMessage,
            });
          }),
        ),
      );

      if (claimedInPass === 0) {
        for (const [executionId, skippedEntry] of claimElsewhere) {
          skipped.set(executionId, skippedEntry);
        }
        break;
      }
    }

    return {
      scannedCount: seenExecutionIds.size,
      recoveredCount: recovered.size,
      skippedCount: skipped.size,
      failedCount: failures.size,
      recovered: Array.from(recovered.values()),
      skipped: Array.from(skipped.values()),
      failures: Array.from(failures.values()),
    };
  }

  private async withRecoveryPermit(
    semaphore: Semaphore,
    signal: AbortSignal | undefined,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await semaphore.withPermit(fn, signal ? { signal } : undefined);
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    }
  }

  private async getPendingTimerTypesByExecutionId(): Promise<
    Map<string, Set<TimerType>>
  > {
    const pendingTimers = await this.store.getReadyTimers(new Date(8.64e15));
    const timerTypesByExecutionId = new Map<string, Set<TimerType>>();

    for (const timer of pendingTimers) {
      if (!timer.executionId) continue;

      let timerTypes = timerTypesByExecutionId.get(timer.executionId);
      if (!timerTypes) {
        timerTypes = new Set<TimerType>();
        timerTypesByExecutionId.set(timer.executionId, timerTypes);
      }

      timerTypes.add(timer.type);
    }

    return timerTypesByExecutionId;
  }

  private getRecoverabilityDecision(
    execution: RecoverableExecution,
    pendingTimerTypesByExecutionId: Map<string, Set<TimerType>>,
  ): RecoverabilityDecision {
    const pendingTimerTypes =
      pendingTimerTypesByExecutionId.get(execution.id) ?? new Set<TimerType>();

    if (
      execution.status === ExecutionStatus.Pending ||
      execution.status === ExecutionStatus.Running
    ) {
      return pendingTimerTypes.has(TimerType.Retry)
        ? { kind: "skip", reason: "pending_timer" }
        : { kind: "recover" };
    }

    if (execution.status === ExecutionStatus.Retrying) {
      return pendingTimerTypes.has(TimerType.Retry)
        ? { kind: "skip", reason: "pending_timer" }
        : { kind: "recover" };
    }

    if (execution.status === ExecutionStatus.Sleeping) {
      return pendingTimerTypes.has(TimerType.Sleep) ||
        pendingTimerTypes.has(TimerType.SignalTimeout)
        ? { kind: "skip", reason: "pending_timer" }
        : { kind: "recover" };
    }

    return { kind: "skip", reason: "not_recoverable" };
  }

  private async tryRecoverExecution(
    execution: RecoverableExecution,
    signal?: AbortSignal,
  ): Promise<RecoveryClaimedOutcome | null> {
    if (signal?.aborted) return null;

    const lockResource = `recovery:execution:${execution.id}`;
    const claimTtlMs = this.config.claimTtlMs ?? 30_000;
    const claimed = await acquireStoreLock({
      store: this.store,
      resource: lockResource,
      ttlMs: claimTtlMs,
      sleep: sleepMs,
    });

    if (claimed === null) return null;

    const claimState = this.createClaimState(execution.id);
    const stopHeartbeat = this.startClaimHeartbeat(
      lockResource,
      claimed.lockId,
      claimTtlMs,
      claimState,
    );

    try {
      if (signal?.aborted) return null;
      const recoverExecution = this.executionManager.recoverExecution(
        execution.id,
      );
      void recoverExecution.catch(() => undefined);
      const winner = await Promise.race([
        recoverExecution.then(() => "recovered" as const),
        claimState.waitForLoss.catch(() => "claim_lost" as const),
      ]);
      if (winner === "recovered") {
        return { kind: "recovered" };
      }
      return null;
    } catch (error) {
      if (claimState.lost || signal?.aborted) {
        return null;
      }
      return {
        kind: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    } finally {
      stopHeartbeat();
      await claimed.release();
    }
  }

  private startClaimHeartbeat(
    resource: string,
    lockId: string | "no-lock",
    ttlMs: number,
    claimState: RecoveryClaimState = this.createDetachedClaimState(),
  ): () => void {
    if (lockId === "no-lock") return () => {};
    if (!this.store.renewLock) return () => {};

    const intervalMs = Math.max(1_000, Math.floor(ttlMs / 3));
    let stopped = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleHeartbeat = () => {
      heartbeatTimer = setTimeout(() => {
        heartbeatTimer = null;
        if (stopped) return;

        void this.store.renewLock!(resource, lockId, ttlMs)
          .then((renewed) => {
            if (!renewed) {
              claimState.markLost();
            }
          })
          .catch(() => {
            // A transient renew failure should not abandon recovery outright;
            // the next renew or store-backed ownership check can still fail closed.
          })
          .finally(() => {
            if (!stopped && !claimState.lost) {
              scheduleHeartbeat();
            }
          });
      }, intervalMs);
      heartbeatTimer.unref?.();
    };

    scheduleHeartbeat();

    return () => {
      stopped = true;
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
    };
  }

  private createClaimState(executionId: string): RecoveryClaimState {
    const lossError = durableExecutionInvariantError.new({
      message: `Recovery claim lost for execution '${executionId}' before recovery finished.`,
    });
    let rejectLoss!: (error: Error) => void;
    const waitForLoss = new Promise<never>((_, reject) => {
      rejectLoss = reject;
    });
    void waitForLoss.catch(() => {});

    const claimState: RecoveryClaimState = {
      lost: false,
      lossError,
      waitForLoss,
      markLost: () => {
        if (claimState.lost) {
          return;
        }
        claimState.lost = true;
        rejectLoss(lossError);
      },
    };

    return claimState;
  }

  private createDetachedClaimState(): RecoveryClaimState {
    const lossError = new Error("detached recovery claim lost");
    const waitForLoss = new Promise<never>(() => undefined);
    const claimState: RecoveryClaimState = {
      lost: false,
      lossError,
      waitForLoss,
      markLost: () => {
        claimState.lost = true;
      },
    };

    return claimState;
  }
}
