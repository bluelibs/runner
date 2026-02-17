import { DebugFriendlyConfig } from "../globals/resources/debug";
import { LogLevels, PrintStrategy } from "../models/Logger";
import { OnUnhandledError } from "../models/UnhandledError";

export type RunOptions = {
  /**
   * Defaults to undefined. If true, we introduce logging to the console.
   */
  debug?: DebugFriendlyConfig;
  /**
   * Configure logging settings.
   */
  logs?: {
    /**
     * Defaults to info. Use null to disable logging.
     */
    printThreshold?: null | LogLevels;
    /**
     * Defaults to PRETTY. How to print the logs.
     */
    printStrategy?: PrintStrategy;
    /**
     * Defaults to false. If true, we buffer logs until the root resource is ready.
     * This provides you with the chance to see the logs before the root resource is ready.
     */
    bufferLogs?: boolean;
  };
  /**
   * When true (default), installs a central error boundary that catches uncaught errors
   * from process-level events and routes them to `onUnhandledError`.
   */
  errorBoundary?: boolean;
  /**
   * When true (default), installs SIGINT/SIGTERM handlers that call dispose() on the root allowing for graceful shutdown.
   */
  shutdownHooks?: boolean;
  /**
   * Custom handler for any unhandled error caught by Runner. Defaults to logging via the created logger.
   */
  onUnhandledError?: OnUnhandledError;
  /**
   * Defaults to false.
   *
   * Dry run mode. When true, the runner will setup the system, ensure there are no errors, but will not start the system.
   * Your resources will not be initialized, and no events will be emitted. This is useful for testing and debugging.
   *
   * Note: this cannot catch init() errors that happen within resources.
   */
  dryRun?: boolean;
  /**
   * Defaults to true.
   * When set, forces runtime cycle detection for event emissions. Disable if you're sure
   * you don't have event deadlocks to improve event emission performance.
   */
  runtimeEventCycleDetection?: boolean;
  /**
   * Defaults to false.
   * When true, startup skips initializing resources that are not used during bootstrap.
   * Such resources can be initialized on-demand via `runResult.getLazyResourceValue(...)`.
   */
  lazy?: boolean;
  /**
   * Defaults to `sequential`.
   * Controls how resources are initialized during startup.
   */
  initMode?: ResourceInitMode | "sequential" | "parallel";
  /**
   * Specify in which mode to run "dev", "prod" or "test".
   * If inside Node this is automatically detected from the NODE_ENV environment variable if not provided.
   */
  mode?: RunnerMode;
};

/**
 * The mode in which the runner is operating
 */
export enum RunnerMode {
  TEST = "test",
  DEV = "dev",
  PROD = "prod",
}

/**
 * Resource initialization strategy during run() bootstrap.
 */
export enum ResourceInitMode {
  Sequential = "sequential",
  Parallel = "parallel",
}
