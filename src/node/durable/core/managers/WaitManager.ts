import type { IDurableStore } from "../interfaces/store";
import type { IEventBus } from "../interfaces/bus";
import type { WaitOptions } from "../interfaces/service";
import { assertFiniteDurationMs, DurableExecutionError } from "../utils";
import { waitForStoreResult } from "./waitForStoreResult";
import { ExecutionStatus } from "../types";

export interface WaitConfig {
  defaultTimeout?: number;
  defaultPollIntervalMs?: number;
}

/**
 * Waits for an execution to reach a terminal state and returns/throws accordingly.
 *
 * Strategy:
 * - if an event bus is configured, subscribe to `execution:<executionId>` for low-latency completion,
 *   and to each continuation tip's channel as the chain grows
 * - poll the store independently so missed notifications or slow subscriptions cannot block progress
 *
 * The durable store remains the source of truth; this manager is purely a convenience layer
 * for callers that want `await durable.wait(...)` / `await durable.startAndWait(...)`.
 * Event-bus notifications are only lightweight nudges; the waiter always re-reads the store
 * for the terminal result or error payload.
 */
export class WaitManager {
  constructor(
    private readonly store: IDurableStore,
    private readonly eventBus?: IEventBus,
    private readonly config?: WaitConfig,
  ) {}

  async waitForResult<TResult>(
    executionId: string,
    options?: WaitOptions,
  ): Promise<TResult> {
    assertFiniteDurationMs("wait timeout", options?.timeout);
    assertFiniteDurationMs("wait poll interval", options?.waitPollIntervalMs);
    const startedAt = Date.now();
    const timeoutMs = options?.timeout ?? this.config?.defaultTimeout;
    const pollEveryMs =
      options?.waitPollIntervalMs ?? this.config?.defaultPollIntervalMs ?? 500;

    const buildTimeoutError = async (): Promise<DurableExecutionError> => {
      const exec = await this.store.getExecution(executionId);
      return new DurableExecutionError(
        `Timeout waiting for execution ${executionId}`,
        executionId,
        exec?.workflowKey || "unknown",
        exec?.attempt || 0,
      );
    };

    let tipId = executionId;
    const check = async (): Promise<
      { done: false; channel: string } | { done: true; value: TResult }
    > => {
      // Advance the cached continuation tip so polls stay O(1) on long chains.
      let currentId = tipId;
      const visited = new Set<string>();
      for (;;) {
        if (visited.has(currentId)) {
          throw new DurableExecutionError(
            `Continuation chain for execution ${executionId} is cyclic at ${currentId}`,
            currentId,
            "unknown",
            0,
          );
        }
        visited.add(currentId);

        const exec = await this.store.getExecution(currentId);
        if (!exec) {
          throw new DurableExecutionError(
            `Execution ${currentId} not found`,
            currentId,
            "unknown",
            0,
          );
        }

        if (exec.status === ExecutionStatus.ContinuedAsNew) {
          if (!exec.continuedAsExecutionId) {
            throw new DurableExecutionError(
              `Continuation chain for execution ${executionId} is broken at ${currentId}`,
              currentId,
              exec.workflowKey || "unknown",
              exec.attempt,
            );
          }
          currentId = exec.continuedAsExecutionId;
          tipId = currentId;
          continue;
        }

        if (exec.status === ExecutionStatus.Completed) {
          return { done: true, value: exec.result as TResult };
        }

        if (exec.status === ExecutionStatus.Failed) {
          throw new DurableExecutionError(
            exec.error?.message || "Execution failed",
            exec.id,
            exec.workflowKey || "unknown",
            exec.attempt,
            exec.error,
          );
        }

        if (exec.status === ExecutionStatus.CompensationFailed) {
          throw new DurableExecutionError(
            exec.error?.message || "Compensation failed",
            exec.id,
            exec.workflowKey || "unknown",
            exec.attempt,
            exec.error,
          );
        }

        if (exec.status === ExecutionStatus.Cancelled) {
          throw new DurableExecutionError(
            exec.error?.message || "Execution cancelled",
            exec.id,
            exec.workflowKey || "unknown",
            exec.attempt,
            exec.error,
          );
        }

        return { done: false, channel: `execution:${currentId}` };
      }
    };

    return waitForStoreResult({
      check,
      channel: `execution:${executionId}`,
      eventBus: this.eventBus,
      startedAt,
      timeoutMs,
      pollEveryMs,
      buildTimeoutError,
    });
  }
}
