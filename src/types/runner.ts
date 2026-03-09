import { DebugFriendlyConfig } from "../globals/resources/debug";
import { LogLevels, PrintStrategy } from "../models/Logger";
import { OnUnhandledError } from "../models/UnhandledError";
import { IEvent, IEventEmitOptions, IEventEmitReport } from "../defs";
import { IResource, IResourceHealthReport } from "./resource";
import { ITask } from "./task";
import { TaskCallOptions } from "./utilities";
import type { ExecutionContextOptions } from "./executionContext";

export interface IHealthReporter {
  /**
   * Evaluates async health checks for all health-enabled resources or a filtered subset.
   */
  getHealth(
    resourceDefs?: Array<string | IResource<any, any, any, any, any>>,
  ): Promise<IResourceHealthReport>;
}

export type RuntimeState = "running" | "paused";

export interface IRuntimeRecoveryHandle {
  cancel(): void;
  id: string;
}

export interface IRuntimeRecoveryOptions {
  id?: string;
  everyMs: number;
  check: () => boolean | Promise<boolean>;
}

/**
 * Common interface for the Runner runtime instance.
 * Provides access to tasks, events, resources, and lifecycle management.
 */
export interface IRuntime<V = unknown> extends IHealthReporter {
  /** Current admission state for new work. */
  readonly state: RuntimeState;

  /**
   * Executes a registered task.
   */
  runTask<TTask extends ITask<any, Promise<any>, any> | string>(
    task: TTask,
    ...args: TTask extends ITask<infer I, any, any>
      ? I extends undefined | void
        ? [input?: I, options?: TaskCallOptions]
        : [input: I, options?: TaskCallOptions]
      : [input?: unknown, options?: TaskCallOptions]
  ): TTask extends ITask<any, infer O, any> ? O : Promise<any>;

  /**
   * Emits an event to trigger hooks.
   */
  emitEvent<P>(
    event: IEvent<P> | string,
    payload?: P extends undefined | void ? undefined : P,
    options?: IEventEmitOptions,
  ): Promise<void | IEventEmitReport>;

  /**
   * Synchronously retrieves an initialized resource value.
   */
  getResourceValue<Output extends Promise<any>>(
    resource: string | IResource<any, Output, any, any, any>,
  ): Output extends Promise<infer U> ? U : Output;

  /**
   * Initializes and returns a resource value on-demand (lazy mode only).
   */
  getLazyResourceValue<Output extends Promise<any>>(
    resource: string | IResource<any, Output, any, any, any>,
  ): Promise<Output extends Promise<infer U> ? U : Output>;

  /**
   * Retrieves the configuration passed to a resource.
   */
  getResourceConfig<Config>(
    resource: string | IResource<Config, any, any, any, any>,
  ): Config;

  /** Returns the ID of the root resource. */
  getRootId(): string;
  /** Returns the configuration passed to the root resource. */
  getRootConfig<Config = unknown>(): Config;
  /** Returns the initialized value of the root resource. */
  getRootValue<Value = V>(): Value;

  /** Stops admitting new external work while allowing active work to continue. */
  pause(reason?: string): void;

  /** Re-opens admissions immediately and clears the active recovery episode. */
  resume(): void;

  /** Registers a recovery condition for the current pause episode. */
  recoverWhen(options: IRuntimeRecoveryOptions): IRuntimeRecoveryHandle;

  /** Disposes the runtime and all resources. */
  dispose(): Promise<void>;
}

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
   * When true (default), installs SIGINT/SIGTERM handlers that trigger graceful shutdown.
   * Signals received during bootstrap will cancel startup, rollback initialized resources,
   * and exit cleanly once teardown completes.
   */
  shutdownHooks?: boolean;
  /**
   * Total disposal budget (milliseconds) for the shutdown lifecycle.
   * This budget covers `disposing` hooks, drain wait, `drained` hooks, and
   * resource disposal. Once exhausted, Runner stops waiting and returns.
   */
  disposeBudgetMs?: number;
  /**
   * Drain budget (milliseconds) used while waiting for in-flight business work
   * (tasks + event listeners) after entering `disposing`.
   * Effective wait is capped by remaining `disposeBudgetMs`.
   * Set to `0` to skip drain waiting.
   */
  disposeDrainBudgetMs?: number;
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
   * Opt-in execution context. Exposes the current causal chain through
   * `system.ctx.executionContext`, automatically assigns a correlation id
   * per top-level execution, and enables cycle detection by default.
   *
   * - `true` → enabled with default correlation ids and cycle detection
   * - `false` or omitted → disabled (zero overhead)
   * - `{ createCorrelationId?, cycleDetection? }` → enabled with custom behavior
   */
  executionContext?: boolean | ExecutionContextOptions;
  /**
   * Defaults to false.
   * When true, startup skips initializing resources that are not used during bootstrap.
   * Such resources can be initialized on-demand via `runResult.getLazyResourceValue(...)`.
   */
  lazy?: boolean;
  /**
   * Defaults to `sequential`.
   * Controls startup and disposal scheduling behavior.
   */
  lifecycleMode?: ResourceLifecycleMode | "sequential" | "parallel";
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
 * Resource lifecycle strategy during run() bootstrap and dispose().
 */
export enum ResourceLifecycleMode {
  Sequential = "sequential",
  Parallel = "parallel",
}
