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
 * Handles waiting for execution results via event bus or polling.
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
    const pollEveryMs = options?.waitPollIntervalMs ?? this.config?.defaultPollIntervalMs ?? 500;

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

        const safeUnsubscribe = async (): Promise<void> => {
          try {
            await eventBus.unsubscribe(channel);
          } catch {
            // ignore
          }
        };

        const finalize = async (
          out: { ok: true; value: TResult } | { ok: false; error: unknown },
        ): Promise<void> => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          await safeUnsubscribe();

          if (out.ok) {
            resolve(out.value);
          } else {
            reject(out.error);
          }
        };

        if (timeoutMs !== undefined) {
          timer = setTimeout(() => {
            void (async () => {
              try {
                const exec = await this.store.getExecution(executionId);
                await finalize({
                  ok: false,
                  error: new DurableExecutionError(
                    `Timeout waiting for execution ${executionId}`,
                    executionId,
                    exec?.taskId || "unknown",
                    exec?.attempt || 0,
                  ),
                });
              } catch (err) {
                await finalize({ ok: false, error: err });
              }
            })();
          }, timeoutMs);
          timer.unref();
        }

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

        void (async () => {
          try {
            await eventBus.subscribe(channel, handler);
            await handler({
              type: "subscribed",
              payload: null,
              timestamp: new Date(),
            });
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
