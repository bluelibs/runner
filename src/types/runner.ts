import { DebugFriendlyConfig } from "../globals/resources/debug";
import { LogLevels, PrintStrategy } from "../models/Logger";
import { OnUnhandledError } from "../models/UnhandledError";
import { IEvent, IEventEmitOptions, IEventEmitReport } from "../defs";
import type {
  ExecutionContextConfig,
  ExecutionContextOptions,
} from "./executionContext";
import type { IAsyncContext } from "./asyncContext";
import { IResource, IResourceHealthReport } from "./resource";
import { ITask } from "./task";
import { TaskCallOptions } from "./utilities";

/**
 * Async context type accepted by `run(..., { identity })`.
 *
 * Apps usually pass a built `r.asyncContext(...).configSchema(...).build()`
 * accessor whose value shape may include `tenantId`, `userId`, and `roles`,
 * alongside any other app-owned identity fields.
 */
export type IdentityAsyncContext = IAsyncContext<any>;

/**
 * Minimal runtime health-reporting contract.
 */
export interface IHealthReporter {
  /**
   * Evaluates async health checks for all health-enabled resources or a filtered subset.
   */
  getHealth(
    resourceDefs?: Array<string | IResource<any, any, any, any, any>>,
  ): Promise<IResourceHealthReport>;
}

export type RuntimeState = "running" | "paused";

/**
 * Handle returned by `runtime.recoverWhen(...)`.
 */
export interface IRuntimeRecoveryHandle {
  /** Stops polling this recovery rule. */
  cancel(): void;
  /** Stable identifier for this recovery rule. */
  id: string;
}

/**
 * Polling rule that can resume the runtime after a pause episode.
 */
export interface IRuntimeRecoveryOptions {
  /** Optional stable id for replacing or tracking the rule. */
  id?: string;
  /** Polling interval in milliseconds. */
  everyMs: number;
  /** Recovery predicate that must pass before Runner auto-resumes. */
  check: () => boolean | Promise<boolean>;
}

/**
 * Optional controls for runtime disposal.
 */
export type RuntimeDisposeOptions = {
  /**
   * Skips any remaining graceful shutdown orchestration that has not started
   * yet and jumps toward direct resource disposal. This can bypass
   * `dispose.cooldownWindowMs`, `events.disposing`, graceful drain wait,
   * `events.aborting`, `dispose.abortWindowMs`, and `events.drained`, but it
   * does not preempt work already in flight such as an active `cooldown()`
   * call.
   */
  force?: boolean;
};

/**
 * Common interface for the Runner runtime instance.
 * Provides access to tasks, events, resources, and lifecycle management.
 */
export interface IRuntime<V = unknown> extends IHealthReporter {
  /** Current admission state for new work. */
  readonly state: RuntimeState;
  /** Normalized run() options captured for this runtime instance. */
  readonly runOptions: ResolvedRunOptions;
  /** Root resource definition for this runtime. */
  readonly root: IResource<any, Promise<V>, any, any, any>;

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

  /** Stops admitting new external work while allowing active work to continue. */
  pause(reason?: string): void;

  /** Re-opens admissions immediately and clears the active recovery episode. */
  resume(): void;

  /** Registers a recovery condition for the current pause episode. */
  recoverWhen(options: IRuntimeRecoveryOptions): IRuntimeRecoveryHandle;

  /** Disposes the runtime and all resources. */
  dispose(options?: RuntimeDisposeOptions): Promise<void>;
}

/**
 * Shutdown timing controls for `run(..., { dispose })`.
 */
export type DisposeOptions = {
  /**
   * Total disposal budget (milliseconds) for the shutdown lifecycle.
   * This budget covers the post-cooldown window, graceful drain wait, and the
   * optional abort wait window.
   * Lifecycle hooks (`disposing`, `aborting`, `drained`) and final resource
   * disposal are still awaited once Runner has already entered those phases,
   * and `cooldown()` itself is fully awaited before those bounded waits begin.
   */
  totalBudgetMs?: number;
  /**
   * Drain budget (milliseconds) used while waiting for in-flight business work
   * (tasks + event listeners) after entering `disposing`.
   * Effective wait is capped by remaining `dispose.totalBudgetMs`.
   * Set to `0` to skip drain waiting. Runner still performs an immediate drain
   * check, so when work remains in flight, shutdown can enter the
   * cooperative-abort phase right away.
   */
  drainingBudgetMs?: number;
  /**
   * Optional bounded cooperative-abort window after graceful drain expires.
   * Runner emits `events.aborting`, aborts its tracked task-local signals,
   * then waits up to this window for in-flight business work to settle.
   * Effective wait is capped by remaining `dispose.totalBudgetMs`. When
   * `drainingBudgetMs` is `0`, this can still run immediately after the
   * initial drain check. Set to `0` to abort immediately without any extra
   * post-abort wait.
   */
  abortWindowMs?: number;
  /**
   * Short bounded post-cooldown window before `disposing` begins.
   * Runner keeps the broader `coolingDown` admission policy open during this
   * window before switching to the stricter `disposing` allowlist. Set to `0`
   * to skip this wait.
   */
  cooldownWindowMs?: number;
};

/**
 * Public runtime options accepted by `run(app, options)`.
 */
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
   * External shutdown trigger for the runtime lifecycle.
   * Aborting this signal cancels bootstrap before readiness (rolling back any
   * initialized resources) or starts graceful disposal after the runtime is
   * ready, without affecting ambient execution signals.
   */
  signal?: AbortSignal;
  /**
   * Shutdown disposal configuration.
   */
  dispose?: DisposeOptions;
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
  /**
   * Enables built-in execution tracing and cycle detection for this runtime.
   */
  executionContext?: boolean | ExecutionContextOptions;
  /**
   * Overrides which async context Runner reads for identity-aware framework
   * features such as identity-scoped cache, rate limits, and temporal
   * policies.
   *
   * App code should continue using this context directly for `provide()`,
   * `use()`, and `require()`. Runner also auto-registers the configured
   * context inside the runtime so it can be used as a dependency.
   */
  identity?: IdentityAsyncContext;
};

/**
 * Fully normalized runtime options stored on the active runtime instance.
 */
export type ResolvedRunOptions = {
  /** Normalized debug configuration. */
  debug?: DebugFriendlyConfig;
  logs: {
    /** Minimum log level printed to the configured sink. */
    printThreshold: null | LogLevels;
    /** Print style used for structured logs. */
    printStrategy: PrintStrategy;
    /** Whether logs are buffered until startup is ready. */
    bufferLogs: boolean;
  };
  /** Whether process-level unhandled error capture is enabled. */
  errorBoundary: boolean;
  /** Whether signal-based graceful shutdown hooks are installed. */
  shutdownHooks: boolean;
  /** Optional external shutdown trigger captured for this runtime instance. */
  signal?: AbortSignal;
  dispose: {
    /** Total shutdown budget in milliseconds. */
    totalBudgetMs: number;
    /** Drain waiting budget in milliseconds. */
    drainingBudgetMs: number;
    /** Post-abort cooperative settle window in milliseconds. */
    abortWindowMs: number;
    /** Post-cooldown admission window in milliseconds. */
    cooldownWindowMs: number;
  };
  /** Normalized unhandled-error callback. */
  onUnhandledError: OnUnhandledError;
  /** Whether dry-run mode is active. */
  dryRun: boolean;
  /** Normalized execution-context configuration for this runtime. */
  executionContext: ExecutionContextConfig | null;
  /** Runtime-specific async context used for identity-aware framework behavior. */
  identity: IdentityAsyncContext | null;
  /** Whether lazy resource startup is active. */
  lazy: boolean;
  /** Normalized lifecycle scheduling mode. */
  lifecycleMode: ResourceLifecycleMode;
  /** Effective runtime mode. */
  mode: RunnerMode;
};

/**
 * Runtime mode used for environment-sensitive behavior.
 */
export enum RunnerMode {
  TEST = "test",
  DEV = "dev",
  PROD = "prod",
}

/**
 * Scheduling strategy for resource lifecycle waves during startup and shutdown.
 */
export enum ResourceLifecycleMode {
  Sequential = "sequential",
  Parallel = "parallel",
}
