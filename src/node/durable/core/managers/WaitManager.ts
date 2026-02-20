import type { IDurableStore } from "../interfaces/store";
import type { IEventBus, BusEvent } from "../interfaces/bus";
import { sleepMs, DurableExecutionError } from "../utils";
import { clearTimeout, setTimeout } from "node:timers";
import { ExecutionStatus } from "../types";

export interface WaitConfig {
  defaultTimeout?: number;
  defaultPollIntervalMs?: number;
}

/**
 * Waits for an execution to reach a terminal state and returns/throws accordingly.
 *
 * Strategy:
 * - if an event bus is configured, subscribe to `execution:<executionId>` for low-latency completion
 * - otherwise (or on bus issues) fall back to polling the store
 *
 * The durable store remains the source of truth; this manager is purely a convenience layer
 * for callers that want `await durable.wait(...)` / `await durable.startAndWait(...)`.
 */
export class WaitManager {
  constructor(
    private readonly store: IDurableStore,
    private readonly eventBus?: IEventBus,
    private readonly config?: WaitConfig,
  ) {}

  async waitForResult<TResult>(
    executionId: string,
    options?: { timeout?: number; waitPollIntervalMs?: number },
  ): Promise<TResult> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeout ?? this.config?.defaultTimeout;
    const pollEveryMs =
      options?.waitPollIntervalMs ?? this.config?.defaultPollIntervalMs ?? 500;

    const check = async (): Promise<TResult | undefined> => {
      const exec = await this.store.getExecution(executionId);
      if (!exec) {
        throw new DurableExecutionError(
          `Execution ${executionId} not found`,
          executionId,
          "unknown",
          0,
        );
      }

      if (exec.status === ExecutionStatus.Completed) {
        if (exec.result === undefined) {
          throw new DurableExecutionError(
            `Execution ${executionId} completed without result`,
            exec.id,
            exec.taskId,
            exec.attempt,
          );
        }
        return exec.result as TResult;
      }

      if (exec.status === ExecutionStatus.Failed) {
        throw new DurableExecutionError(
          exec.error?.message || "Execution failed",
          exec.id,
          exec.taskId,
          exec.attempt,
          exec.error,
        );
      }

      if (exec.status === ExecutionStatus.CompensationFailed) {
        throw new DurableExecutionError(
          exec.error?.message || "Compensation failed",
          exec.id,
          exec.taskId,
          exec.attempt,
          exec.error,
        );
      }

      if (exec.status === ExecutionStatus.Cancelled) {
        throw new DurableExecutionError(
          exec.error?.message || "Execution cancelled",
          exec.id,
          exec.taskId,
          exec.attempt,
          exec.error,
        );
      }

      return undefined;
    };

    const pollingFallback = async (): Promise<TResult> => {
      while (true) {
        const result = await check();
        if (result !== undefined) return result;

        if (timeoutMs !== undefined && Date.now() - startedAt > timeoutMs) {
          const exec = await this.store.getExecution(executionId);
          throw new DurableExecutionError(
            `Timeout waiting for execution ${executionId}`,
            executionId,
            exec?.taskId || "unknown",
            exec?.attempt || 0,
          );
        }

        await sleepMs(pollEveryMs);
      }
    };

    // Initial check
    const initialResult = await check();
    if (initialResult !== undefined) return initialResult;

    // Use EventBus if available
    if (this.eventBus) {
      const eventBus = this.eventBus;
      return new Promise<TResult>((resolve, reject) => {
        const channel = `execution:${executionId}`;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let pollTimer: ReturnType<typeof setTimeout> | null = null;
        let done = false;
        let skipEventBusSubscription = false;

        const handler = async (_event: BusEvent) => {
          try {
            const result = await check();
            if (result !== undefined) {
              await finalize({ ok: true, value: result });
            }
          } catch (err) {
            await finalize({ ok: false, error: err });
          }
        };

        const safeUnsubscribe = async (): Promise<void> => {
          try {
            await eventBus.unsubscribe(channel, handler);
          } catch {
            // ignore
          }
        };

        const finalize = async (
          out: { ok: true; value: TResult } | { ok: false; error: unknown },
        ): Promise<void> => {
          if (done) return;
          done = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
          }
          await safeUnsubscribe();

          if (out.ok) {
            resolve(out.value);
          } else {
            reject(out.error);
          }
        };

        // Preflight store check before wiring timers/subscriptions.
        // This reduces race windows and keeps timeout metadata checks consistent.
        void (async () => {
          try {
            const result = await check();
            if (result !== undefined) {
              await finalize({ ok: true, value: result });
            }
          } catch (err) {
            await finalize({ ok: false, error: err });
          }
        })();

        const buildTimeoutError = async (): Promise<DurableExecutionError> => {
          const exec = await this.store.getExecution(executionId);
          return new DurableExecutionError(
            `Timeout waiting for execution ${executionId}`,
            executionId,
            exec?.taskId || "unknown",
            exec?.attempt || 0,
          );
        };

        if (timeoutMs !== undefined) {
          const elapsedMs = Date.now() - startedAt;
          const remainingTimeoutMs = timeoutMs - elapsedMs;

          const timeoutHandler = () => {
            void (async () => {
              try {
                await finalize({
                  ok: false,
                  error: await buildTimeoutError(),
                });
              } catch (err) {
                await finalize({ ok: false, error: err });
              }
            })();
          };

          if (remainingTimeoutMs <= 0) {
            skipEventBusSubscription = true;
            timeoutHandler();
          } else {
            timer = setTimeout(timeoutHandler, remainingTimeoutMs);
            timer.unref();
          }
        }

        const pollOnce = async (): Promise<void> => {
          if (done) return;
          try {
            const result = await check();
            if (result !== undefined) {
              await finalize({ ok: true, value: result });
              return;
            }
          } catch (err) {
            await finalize({ ok: false, error: err });
            return;
          }

          pollTimer = setTimeout(() => void pollOnce(), pollEveryMs);
          pollTimer.unref();
        };

        void (async () => {
          try {
            if (skipEventBusSubscription) {
              return;
            }
            await eventBus.subscribe(channel, handler);
            await handler({
              type: "subscribed",
              payload: null,
              timestamp: new Date(),
            });
            await pollOnce();
          } catch {
            // Fallback to polling if subscription fails
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            pollingFallback().then(resolve).catch(reject);
          }
        })();
      });
    }

    return pollingFallback();
  }
}
