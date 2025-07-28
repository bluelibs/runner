import { defineMiddleware } from "../../define";

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

export const retryMiddleware = defineMiddleware({
  id: "global.middleware.retry",
  async run({ task, resource, next }, deps, config: RetryMiddlewareConfig) {
    const input = task ? task.input : resource?.config;
    let attempts = 0;

    // Set defaults for required parameters
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

        // Calculate delay using custom strategy or default exponential backoff
        const delay = config.delayStrategy
          ? config.delayStrategy(attempts, err)
          : 100 * Math.pow(2, attempts);

        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        attempts++;
      }
    }
  },
});
