import { cancellationError } from "../errors";

/**
 * A lightweight handle returned by signal-composition helpers.
 *
 * `cleanup()` is intentionally part of the contract because a composed signal
 * may be backed by temporary event listeners that must be removed once the
 * caller finishes waiting on the signal.
 */
export interface AbortSignalLink {
  signal: AbortSignal | undefined;
  cleanup(): void;
}

/**
 * Normalizes the platform-specific abort reason shape into a human-readable
 * message that can be surfaced through Runner's typed cancellation errors.
 */
function toAbortReason(signal: AbortSignal, fallback: string): string {
  const reason = signal.reason;
  if (typeof reason === "string" && reason.length > 0) {
    return reason;
  }

  if (reason instanceof Error && reason.message.length > 0) {
    return reason.message;
  }

  if (reason !== undefined) {
    return String(reason);
  }

  return fallback;
}

/**
 * Converts an aborted signal into Runner's canonical cancellation error.
 */
export function createCancellationErrorFromSignal(
  signal: AbortSignal,
  fallbackReason = "Operation cancelled",
): Error {
  return cancellationError.new({
    reason: toAbortReason(signal, fallbackReason),
  });
}

/**
 * Throws Runner's canonical cancellation error for an aborted signal.
 */
export function throwCancellationErrorFromSignal(
  signal: AbortSignal,
  fallbackReason = "Operation cancelled",
): never {
  throw createCancellationErrorFromSignal(signal, fallbackReason);
}

/**
 * Returns a signal view over one or more cancellation sources.
 * When multiple signals are present, a temporary controller is linked lazily
 * and must be cleaned up after the execution completes.
 */
export function linkAbortSignals(
  signals: ReadonlyArray<AbortSignal | undefined>,
): AbortSignalLink {
  const activeSignals = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );

  if (activeSignals.length === 0) {
    return {
      signal: undefined,
      cleanup() {},
    };
  }

  const abortedSignal = activeSignals.find((signal) => signal.aborted);
  if (abortedSignal) {
    return {
      signal: abortedSignal,
      cleanup() {},
    };
  }

  if (activeSignals.length === 1) {
    return {
      signal: activeSignals[0],
      cleanup() {},
    };
  }

  const controller = new AbortController();
  const cleanupFns: Array<() => void> = [];

  const cleanup = () => {
    while (cleanupFns.length > 0) {
      cleanupFns.pop()!();
    }
  };

  for (const signal of activeSignals) {
    const onAbort = () => {
      cleanup();
      controller.abort(signal.reason);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    cleanupFns.push(() => signal.removeEventListener("abort", onAbort));
  }

  return {
    signal: controller.signal,
    cleanup,
  };
}

/**
 * Rejects when the signal aborts first while ensuring listeners are detached on
 * either completion path.
 */
export function raceWithAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  fallbackReason = "Operation cancelled",
): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(
      createCancellationErrorFromSignal(signal, fallbackReason),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(createCancellationErrorFromSignal(signal, fallbackReason));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
