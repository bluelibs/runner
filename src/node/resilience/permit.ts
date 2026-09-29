import { acquireRedisPermit, type PermitQueue } from "./acquirePermit";
import type { ConcurrencyWaitOptions } from "../../globals/middleware/concurrency/wait";
import { randomUUID } from "node:crypto";
import { resilienceError } from "../../globals/resilience/errors";
import { abortableDelay } from "../../globals/middleware/retry.middleware";

interface PermitOptions<T> {
  execute: (operation: string, token: string) => Promise<boolean>;
  wait?: ConcurrencyWaitOptions;
  queue?: PermitQueue;
  leaseMs: number;
  signal: AbortSignal | undefined;
  shutdown: AbortSignal;
  abort: (reason: Error) => void;
  run: () => Promise<T>;
}

/** Keeps admission ownership alive until work settles; lease loss aborts cooperatively. */
export async function withRedisPermit<T>(
  options: PermitOptions<T>,
): Promise<T> {
  const { execute, leaseMs, abort, run, shutdown } = options;
  const signal = options.signal
    ? AbortSignal.any([options.signal, shutdown])
    : shutdown;
  const token = randomUUID();
  signal.throwIfAborted();
  let leaseDeadline = await acquireRedisPermit(
    execute,
    token,
    leaseMs,
    signal,
    options.wait,
    options.queue,
  );
  const remainingLease = () => Math.max(0, leaseDeadline - performance.now());
  const heartbeat = new AbortController();
  let rejectOwnership: (error: Error) => void;
  const ownership = new Promise<never>((_resolve, reject) => {
    rejectOwnership = reject;
  });
  const loseOwnership = (error: Error) => {
    abort(error);
    rejectOwnership(error);
  };
  const expired = () =>
    loseOwnership(
      resilienceError.new({
        message: "Distributed concurrency permit ownership was lost.",
      }),
    );
  // A separate deadline also detects a stalled Redis renewal request.
  let deadline = setTimeout(expired, remainingLease());
  const stop = () =>
    loseOwnership(
      resilienceError.new({ message: "Resilience resource is disposing." }),
    );
  shutdown.addEventListener("abort", stop, { once: true });
  const renewal = (async () => {
    try {
      while (!heartbeat.signal.aborted) {
        await abortableDelay(
          Math.max(1, Math.floor(leaseMs / 3)),
          heartbeat.signal,
        );
        const requestedAt = performance.now();
        if (
          !(await execute("renew", token)) ||
          performance.now() - requestedAt >= leaseMs
        ) {
          expired();
          return;
        }
        leaseDeadline = requestedAt + leaseMs;
        clearTimeout(deadline);
        deadline = setTimeout(expired, remainingLease());
      }
    } catch (error) {
      if (!heartbeat.signal.aborted) {
        loseOwnership(
          error instanceof Error
            ? error
            : resilienceError.new({ message: String(error) }),
        );
      }
    }
  })();
  try {
    // Attach the race before entering user code, including synchronous throws.
    return await Promise.race([
      ownership,
      (async () => {
        signal.throwIfAborted();
        if (remainingLease() === 0) {
          throw resilienceError.new({
            message: "Distributed concurrency permit expired before execution.",
          });
        }
        const value = await run();
        if (heartbeat.signal.aborted) return value;
        // Detect expired ownership even when the event loop could not run timers.
        const requestedAt = performance.now();
        if (
          !(await execute("renew", token)) ||
          performance.now() - requestedAt >= leaseMs
        ) {
          throw resilienceError.new({
            message:
              "Distributed concurrency permit expired before completion.",
          });
        }
        return value;
      })(),
    ]);
  } finally {
    heartbeat.abort();
    shutdown.removeEventListener("abort", stop);
    clearTimeout(deadline);
    await renewal;
    clearTimeout(deadline);
    await execute("release", token);
  }
}
