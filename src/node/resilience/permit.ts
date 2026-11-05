import { acquireRedisPermit, type PermitQueue } from "./acquirePermit";
import type { ConcurrencyWaitOptions } from "../../globals/middleware/concurrency/wait";
import { randomUUID } from "node:crypto";
import { resilienceError } from "../../globals/resilience/errors";
import { createRenewableLease } from "./renewableLease";

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
  const leaseDeadline = await acquireRedisPermit(
    execute,
    token,
    leaseMs,
    signal,
    options.wait,
    options.queue,
  );
  const lease = createRenewableLease({
    leaseMs,
    leaseDeadline,
    renew: () => execute("renew", token),
    release: () => execute("release", token),
    onLoss: abort,
    errors: {
      lost: () =>
        resilienceError.new({
          message: "Distributed concurrency permit ownership was lost.",
        }),
      beforeExecution: () =>
        resilienceError.new({
          message: "Distributed concurrency permit expired before execution.",
        }),
      beforeCompletion: () =>
        resilienceError.new({
          message: "Distributed concurrency permit expired before completion.",
        }),
      renewal: (error) =>
        error instanceof Error
          ? error
          : resilienceError.new({ message: String(error) }),
    },
  });
  const stop = () =>
    lease.fail(
      resilienceError.new({ message: "Resilience resource is disposing." }),
    );
  shutdown.addEventListener("abort", stop, { once: true });
  try {
    return await Promise.race([
      lease.lost,
      (async () => {
        signal.throwIfAborted();
        lease.assertActive();
        const value = await run();
        await lease.assertOwnership();
        return value;
      })(),
    ]);
  } finally {
    shutdown.removeEventListener("abort", stop);
    await lease.release();
  }
}
