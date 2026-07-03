import type { IDurableStore } from "../interfaces/store";
import type { IEventBus } from "../interfaces/bus";
import { Logger } from "../../../../models/Logger";
import { runtimeShutdownAbortReason } from "../../../../tools/runtimeShutdownAbortReason";
import {
  getCancellationState,
  publishExecutionCancellationRequested,
  startExecutionCancellationPollingFallback,
  startLiveExecutionCancellationListener,
} from "./ExecutionManager.cancellation";

export interface AttemptCancellationControllerDeps {
  store: IDurableStore;
  logger: Logger;
  /**
   * Bus used to broadcast/observe live cancellation control messages. Null when
   * no real event bus is configured (embedded mode), in which case cancellation
   * relies on the per-attempt polling fallback only.
   */
  liveCancellationEventBus: IEventBus | null;
}

/**
 * Owns the live, in-memory side of cancellation: the set of in-flight attempt
 * abort controllers, the shutdown-interruption latch, and the optional live
 * cancellation listener. Kept separate from {@link ExecutionManager} so the
 * coordinator stays free of mutable abort bookkeeping.
 */
export class AttemptCancellationController {
  private readonly activeAttemptControllers = new Map<
    string,
    AbortController
  >();
  private shutdownInterruptionReason: string | null = null;
  private liveCancellationListenerStop: (() => Promise<void>) | null = null;

  constructor(private readonly deps: AttemptCancellationControllerDeps) {}

  /**
   * The reason supplied to the most recent {@link interruptActiveAttempts}, used
   * by attempt-error handling to recognise a cooperative shutdown abort and let
   * the execution resume on the next runtime instead of failing it.
   */
  getShutdownInterruptionReason(): string | null {
    return this.shutdownInterruptionReason;
  }

  async startListener(): Promise<void> {
    const eventBus = this.deps.liveCancellationEventBus;
    if (!eventBus || this.liveCancellationListenerStop) {
      return;
    }

    try {
      this.liveCancellationListenerStop =
        await startLiveExecutionCancellationListener({
          eventBus,
          abortActiveAttempt: (executionId, reason) =>
            this.abortActiveAttempt(executionId, reason),
        });
    } catch (error) {
      this.liveCancellationListenerStop = null;
      try {
        await this.deps.logger.warn(
          "Durable live cancellation listener failed to start; falling back to per-attempt polling.",
          { error },
        );
      } catch {
        // Logging must not fail service startup; registration falls back to polling.
      }
    }
  }

  async stopListener(): Promise<void> {
    const stop = this.liveCancellationListenerStop;
    this.liveCancellationListenerStop = null;
    if (!stop) {
      return;
    }

    await stop();
  }

  interruptActiveAttempts(reason = runtimeShutdownAbortReason): void {
    this.shutdownInterruptionReason = reason;

    for (const controller of this.activeAttemptControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    }
  }

  abortActiveAttempt(executionId: string, reason: string): void {
    const controller = this.activeAttemptControllers.get(executionId);
    if (!controller || controller.signal.aborted) return;
    controller.abort(reason);
  }

  async publishLiveCancellationRequested(
    executionId: string,
    reason: string,
  ): Promise<void> {
    const eventBus = this.deps.liveCancellationEventBus;
    if (!eventBus) {
      return;
    }

    try {
      await publishExecutionCancellationRequested({
        eventBus,
        executionId,
        reason,
      });
    } catch (error) {
      try {
        await this.deps.logger.warn(
          "Durable live cancellation publish failed; relying on local abort or polling fallback.",
          {
            executionId,
            error,
          },
        );
      } catch {
        // Logging must not affect durable cancellation semantics.
      }
    }
  }

  /**
   * Registers an abort controller for an attempt. When a live listener is active
   * it does a single immediate store recheck (covering a cancellation that
   * landed before registration); otherwise it arms the polling fallback.
   */
  async registerAttemptCancellation(params: {
    executionId: string;
  }): Promise<{ signal: AbortSignal; stop: () => void }> {
    const controller = new AbortController();
    this.activeAttemptControllers.set(params.executionId, controller);
    let stopWatcher: (() => void) | undefined;

    if (this.liveCancellationListenerStop) {
      try {
        const execution = await this.deps.store.getExecution(
          params.executionId,
        );
        const cancellationState = getCancellationState(execution);
        if (cancellationState) {
          this.abortActiveAttempt(params.executionId, cancellationState.reason);
        }
      } catch (error) {
        try {
          await this.deps.logger.warn(
            "Durable live cancellation recheck failed; falling back to per-attempt polling.",
            {
              executionId: params.executionId,
              error,
            },
          );
        } catch {
          // Logging must not affect cancellation propagation fallback.
        }

        if (!controller.signal.aborted) {
          stopWatcher = this.startPollingFallback({
            executionId: params.executionId,
            controller,
          });
        }
      }
    } else {
      stopWatcher = this.startPollingFallback({
        executionId: params.executionId,
        controller,
      });
    }

    return {
      signal: controller.signal,
      stop: () => {
        stopWatcher?.();
        if (
          this.activeAttemptControllers.get(params.executionId) === controller
        ) {
          this.activeAttemptControllers.delete(params.executionId);
        }
      },
    };
  }

  private startPollingFallback(params: {
    executionId: string;
    controller: AbortController;
  }): () => void {
    return startExecutionCancellationPollingFallback({
      executionId: params.executionId,
      controller: params.controller,
      store: this.deps.store,
      abortActiveAttempt: (id, reason) => this.abortActiveAttempt(id, reason),
    });
  }
}
