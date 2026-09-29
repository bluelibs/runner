import { abortableDelay } from "../../globals/middleware/retry.middleware";
import {
  assertQueueAvailable,
  type ConcurrencyWaitOptions,
} from "../../globals/middleware/concurrency/wait";
import { middlewareConcurrencyWaitTimeoutError } from "../../globals/middleware/concurrency/errors";

/** Local waiter accounting shared by calls targeting the same Redis pool. */
export interface PermitQueue {
  /** Fully resolved pool identity, including identity scope. */
  key: string;
  /** Runtime-local waiting counts; entries are removed when the queue drains. */
  counts: Map<string, number>;
}

type Execute = (operation: string, token: string) => Promise<boolean>;

function releaseCancelledGrant(execute: Execute, token: string): void {
  // Cancellation must not wait for Redis; the lease expires if cleanup fails.
  void execute("release", token).catch(() => {});
}

/** Cancels the caller promptly while reclaiming any grant delivered after cancellation. */
function attempt(
  execute: Execute,
  token: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      settled = true;
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void execute("acquire", token).then(
      (granted) => {
        if (settled) {
          if (granted) releaseCancelledGrant(execute, token);
          return;
        }
        settled = true;
        cleanup();
        resolve(granted);
      },
      (error: unknown) => {
        cleanup();
        if (!settled) reject(error);
      },
    );
  });
}

/** Returns the conservative local expiry of the newly acquired Redis lease. */
export async function acquireRedisPermit(
  execute: Execute,
  token: string,
  leaseMs: number,
  caller: AbortSignal,
  wait: ConcurrencyWaitOptions = {},
  queue?: PermitQueue,
): Promise<number> {
  const deadline = new AbortController();
  const signal = AbortSignal.any([caller, deadline.signal]);
  const timer =
    wait.waitTimeoutMs !== undefined && wait.waitTimeoutMs > 0
      ? setTimeout(
          () =>
            deadline.abort(
              middlewareConcurrencyWaitTimeoutError.new({
                waitTimeoutMs: wait.waitTimeoutMs!,
              }),
            ),
          wait.waitTimeoutMs,
        )
      : undefined;
  let queued = false;
  try {
    while (true) {
      const requestedAt = performance.now();
      if (await attempt(execute, token, signal)) {
        if (signal.aborted) {
          releaseCancelledGrant(execute, token);
          signal.throwIfAborted();
        }
        return requestedAt + leaseMs;
      }
      if (!queued) {
        const waiting = queue?.counts.get(queue.key) ?? 0;
        assertQueueAvailable(waiting, wait);
        queue?.counts.set(queue.key, waiting + 1);
        queued = true;
      }
      await abortableDelay(Math.min(100, leaseMs / 3), signal);
    }
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
    if (queued && queue) {
      const remaining = queue.counts.get(queue.key)! - 1;
      if (remaining === 0) queue.counts.delete(queue.key);
      else queue.counts.set(queue.key, remaining);
    }
  }
}
