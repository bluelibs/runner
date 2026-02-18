import { defineTaskMiddleware, defineResourceMiddleware } from "../../define";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { journalKeys as timeoutJournalKeys } from "./timeout.middleware";

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

/**
 * Journal keys exposed by the retry middleware.
 * Use these to access shared state from downstream middleware or tasks.
 */
export const journalKeys = {
  /** Current retry attempt number (0 = first attempt, 1 = first retry, etc.) */
  attempt: journalHelper.createKey<number>("globals.middleware.retry.attempt"),
  /** The last error that caused a retry */
  lastError: journalHelper.createKey<Error>(
    "globals.middleware.retry.lastError",
  ),
} as const;

export const retryTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.retry.task",
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

        // Check if timeout middleware has set an abort controller (fetch dynamically)
        const abortController = journal.get(timeoutJournalKeys.abortController);

        // Don't retry if the operation was aborted (timeout triggered)
        if (abortController?.signal.aborted) {
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
          await new Promise((resolve) => setTimeout(resolve, delay));
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
  id: "globals.middleware.retry.resource",
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
          await new Promise((resolve) => setTimeout(resolve, delay));
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
