import { defineResourceMiddleware } from "../../definers/defineResourceMiddleware";
import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { getTaskAbortSignalLink } from "../../models/runtime/taskCancellation";
import { Match } from "../../tools/check";
import { createCancellationErrorFromSignal } from "../../tools/abortSignals";

/**
 * Configuration options for the retry middleware
 */
export interface RetryMiddlewareConfig {
  /**
   * Maximum number of retry attempts (default: 3)
   */
  retries?: number;
  /**
   * Callback to determine if retry should stop based on error
   * @default () => false (retry all errors)
   */
  stopRetryIf?: (error: Error) => boolean;
  /**
   * Custom delay strategy function
   * @default Exponential backoff starting at 100ms
   */
  delayStrategy?: (attempt: number, error: Error) => number;
}

const retryConfigPattern = Match.ObjectIncluding({
  retries: Match.Optional(Match.PositiveInteger),
  stopRetryIf: Match.Optional(Function),
  delayStrategy: Match.Optional(Function),
});

/**
 * Journal keys exposed by the retry middleware.
 * Use these to access shared state from downstream middleware or tasks.
 */
export const journalKeys = {
  /** Current retry attempt number (0 = first attempt, 1 = first retry, etc.) */
  attempt: journalHelper.createKey<number>("runner.middleware.retry.attempt"),
  /** The last error that caused a retry */
  lastError: journalHelper.createKey<Error>(
    "runner.middleware.retry.lastError",
  ),
} as const;

export const retryTaskMiddleware = defineTaskMiddleware({
  id: "retry",
  meta: {
    title: "Retry",
    description:
      "Retries failed task executions with configurable attempt limits, delays, and stop conditions.",
  },
  configSchema: retryConfigPattern,
  async run({ task, next, journal }, _deps, config: RetryMiddlewareConfig) {
    const input = task?.input;
    let attempts = 0;

    // Set defaults for required parameters
    const maxRetries = config.retries ?? 3;
    const shouldStop = config.stopRetryIf ?? (() => false);

    // Set initial attempt count
    journal.set(journalKeys.attempt, attempts, { override: true });

    while (true) {
      try {
        return await next(input);
      } catch (error) {
        const err = error as Error;
        const signalLink = getTaskAbortSignalLink(journal);
        const signal = signalLink.signal;

        try {
          if (signal?.aborted) {
            throw error;
          }

          if (shouldStop(err) || attempts >= maxRetries) {
            throw error;
          }

          // Calculate delay using custom strategy or default exponential backoff
          const delay = config.delayStrategy
            ? config.delayStrategy(attempts, err)
            : getDefaultRetryDelayMs(attempts);

          if (delay > 0) {
            await abortableDelay(delay, signal);
          }
        } finally {
          signalLink.cleanup();
        }

        attempts++;
        // Update journal with current attempt and last error
        journal.set(journalKeys.attempt, attempts, { override: true });
        journal.set(journalKeys.lastError, err, { override: true });
      }
    }
  },
});

export const retryResourceMiddleware = defineResourceMiddleware({
  id: "retry",
  meta: {
    title: "Retry",
    description:
      "Retries failed resource init executions with configurable attempt limits, delays, and stop conditions.",
  },
  configSchema: retryConfigPattern,
  async run({ resource, next }, _deps, config: RetryMiddlewareConfig) {
    const input = resource?.config;
    let attempts = 0;
    const maxRetries = config.retries ?? 3;
    const shouldStop = config.stopRetryIf ?? (() => false);
    while (true) {
      try {
        return await next(input);
      } catch (error) {
        const err = error as Error;
        if (shouldStop(err) || attempts >= maxRetries) {
          throw error;
        }
        const delay = config.delayStrategy
          ? config.delayStrategy(attempts, err)
          : getDefaultRetryDelayMs(attempts);
        if (delay > 0) {
          await abortableDelay(delay);
        }
        attempts++;
      }
    }
  },
});

function getDefaultRetryDelayMs(attempt: number): number {
  const baseDelayMs = 100 * Math.pow(2, attempt);
  const jitterMs = Math.floor(Math.random() * Math.max(1, baseDelayMs / 2));
  return baseDelayMs + jitterMs;
}

/**
 * Delay that can be cancelled via an AbortSignal so retries don't block disposal.
 * @internal Exported for testing only.
 */
export function abortableDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  const activeSignal = signal;
  if (activeSignal.aborted) {
    return Promise.reject(createCancellationErrorFromSignal(activeSignal));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      activeSignal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(createCancellationErrorFromSignal(activeSignal));
    }
    activeSignal.addEventListener("abort", onAbort, { once: true });
  });
}
