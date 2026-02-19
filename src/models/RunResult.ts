import {
  IEvent,
  IEventEmitOptions,
  IEventEmitReport,
  IResource,
  ITask,
} from "../defs";
import { IRuntime } from "../types/runner";
import type { TaskCallOptions } from "../types/utilities";
// For RunResult convenience API, preserve the original simple messages
import type { EventManager } from "./EventManager";
import type { Logger } from "./Logger";
import type { Store } from "./Store";
import type { TaskRunner } from "./TaskRunner";
import {
  lazyResourceAccessDisabledError,
  lazyResourceSyncAccessError,
  runResultDisposeDuringBootstrapError,
  runResultDisposedError,
  runtimeElementNotFoundError,
  runtimeRootNotAvailableError,
  runtimeRootNotInitializedError,
} from "../errors";

/**
 * Options for configuring lazy resource loading behavior.
 * Used to enable on-demand resource initialization to improve startup time.
 */
type RunResultLazyOptions = {
  /**
   * Whether lazy loading mode is enabled.
   * When true, resources not used at startup are not initialized until accessed.
   */
  lazyMode?: boolean;

  /**
   * Set of resource IDs that were not initialized at startup.
   * These resources require lazy loading to be accessed.
   */
  startupUnusedResourceIds?: ReadonlySet<string>;

  /**
   * Custom loader function for lazy resource initialization.
   * Called when accessing a resource that hasn't been initialized yet.
   */
  lazyResourceLoader?: <T>(resourceId: string) => Promise<T>;
};

/**
 * RunResult represents the runtime instance after executing `run(root)`.
 * It provides access to tasks, events, resources, and lifecycle management.
 *
 * Key features:
 * - Task execution via `runTask()`
 * - Event emission via `emitEvent()`
 * - Resource access via `getResourceValue()` / `getLazyResourceValue()`
 * - Root access via `getRootValue()`, `getRootConfig()`, `getRootId()`
 * - Disposal via `dispose()`
 *
 * @example
 * const runtime = await run(app);
 * const result = await runtime.runTask(myTask, { input: "data" });
 * await runtime.dispose();
 */
export class RunResult<V> implements IRuntime<V> {
  /**
   * The root value returned by the root resource's init function.
   * Set via `setValue()` after the root resource initializes.
   */
  #value: V | undefined;

  /**
   * Flag indicating the runtime has been fully disposed.
   * Once disposed, all operations (runTask, emitEvent, etc.) will throw.
   */
  #disposed = false;

  /**
   * Flag indicating disposal is in progress.
   * Prevents concurrent disposal calls.
   */
  #disposing = false;

  /**
   * Promise that resolves when disposal completes.
   * Used to coordinate multiple concurrent dispose() calls.
   */
  #disposePromise: Promise<void> | undefined;

  /**
   * Flag indicating bootstrap (initialization) is still in progress.
   * Prevents disposal during the bootstrap phase.
   */
  #isBootstrapping = true;

  /**
   * Options for lazy resource loading mode.
   * When enabled, unused resources are not initialized until accessed.
   */
  private lazyOptions: RunResultLazyOptions = {};

  /**
   * Creates a new RunResult instance.
   *
   * @param logger - The framework logger for runtime diagnostics
   * @param store - The central store containing all registered tasks, events, resources
   * @param eventManager - Handles event emission and hook execution
   * @param taskRunner - Executes tasks with middleware and validation
   * @param disposeFn - Callback to clean up all resources during disposal
   */
  constructor(
    /**
     * Framework logger for diagnostics and debugging.
     * Use this for logging within tasks or hooks.
     */
    public readonly logger: Logger,
    /**
     * Central store containing all registered definitions.
     * Provides access to tasks, events, resources, and their metadata.
     */
    public readonly store: Store,
    /**
     * Event manager for emitting events and triggering hooks.
     * Handles both sync and async event propagation.
     */
    private readonly eventManager: EventManager,
    /**
     * Task runner that executes tasks with middleware pipeline.
     * Handles dependency injection, validation, and error handling.
     */
    private readonly taskRunner: TaskRunner,
    /**
     * Function to call during disposal.
     * Disposes all resources in reverse initialization order.
     */
    private readonly disposeFn: () => Promise<void>,
  ) {}

  /**
   * Returns the root value initialized by the root resource.
   * Only available after the root resource has been initialized.
   */
  public get value(): V {
    return this.#value as V;
  }

  /**
   * Ensures the runtime is active and can accept operations.
   * Throws if the runtime has been disposed or is currently disposing.
   * @internal
   */
  private ensureRuntimeIsActive() {
    if (this.#disposed || this.#disposing) {
      runResultDisposedError.throw();
    }
  }

  /**
   * Retrieves the root resource from the store.
   * Throws if the root hasn't been set (e.g., during early access).
   * @internal
   */
  private getRootOrThrow() {
    if (!this.store.root) {
      runtimeRootNotAvailableError.throw();
    }

    return this.store.root;
  }

  /**
   * Configures lazy loading options for resources.
   * Used to enable on-demand resource initialization.
   * @param options - Lazy mode configuration
   */
  public setLazyOptions(options: RunResultLazyOptions) {
    this.lazyOptions = options;
  }

  /**
   * Sets the root value after the root resource initializes.
   * @param value - The initialized root value
   */
  public setValue(value: V | undefined) {
    this.#value = value;
    this.#isBootstrapping = false;
  }

  /**
   * Executes a registered task within the runtime context.
   *
   * The task runs through its full middleware pipeline including:
   * - Input validation (via inputSchema)
   - Middleware (retry, cache, timeout, etc.)
   - The task's core logic
   - Result validation (via resultSchema)
   *
   * @example
   * // Run with task definition
   * const result = await runtime.runTask(createUser, { name: "Alice" });
   *
   * // Run with options for journal forwarding
   * const result = await runtime.runTask(greet, undefined, { journal });
   */
  public runTask = <TTask extends ITask<any, Promise<any>, any> | string>(
    task: TTask,
    ...args: TTask extends ITask<infer I, any, any>
      ? I extends undefined | void
        ? [input?: I, options?: TaskCallOptions]
        : [input: I, options?: TaskCallOptions]
      : [input?: unknown, options?: TaskCallOptions]
  ): TTask extends ITask<any, infer O, any> ? O : Promise<any> => {
    this.ensureRuntimeIsActive();
    const [input, options] = args as [unknown, TaskCallOptions | undefined];
    let resolvedTask: ITask<any, Promise<any>, any>;

    if (typeof task === "string") {
      const taskId = task;
      if (!this.store.tasks.has(taskId)) {
        runtimeElementNotFoundError.throw({ type: "Task", elementId: taskId });
      }
      resolvedTask = this.store.tasks.get(taskId)!.task;
    } else {
      resolvedTask = task;
    }

    return this.taskRunner.run(
      resolvedTask,
      input,
      options,
    ) as TTask extends ITask<any, infer O, any> ? O : Promise<any>;
  };

  /**
   * Emits an event to trigger all registered hooks listening for it.
   *
   * Events are emitted synchronously or asynchronously depending on hook configuration.
   * Hooks execute in order based on their `order()` value (lower runs first).
   *
   * @param event - The event definition or event ID string to emit
   * @param payload - The event payload data
   * @param options - Emission options (failureMode, throwOnError, report)
   * @returns Promise<void> by default, or IEventEmitReport if report: true
   *
   * @example
   * // Basic emission
   * await runtime.emitEvent(userRegistered, { userId: "123", email: "a@b.com" });
   *
   * // With report for hook failure tracking
   * const report = await runtime.emitEvent(notify, undefined, { report: true });
   * if (report.failedListeners.length > 0) {
   *   console.error("Failed hooks:", report.failedListeners);
   * }
   */
  public emitEvent = (<P>(
    event: IEvent<P> | string,
    payload?: P extends undefined | void ? undefined : P,
    options?: IEventEmitOptions,
  ) => {
    this.ensureRuntimeIsActive();

    if (typeof event === "string") {
      const eventId = event;
      if (!this.store.events.has(eventId)) {
        runtimeElementNotFoundError.throw({
          type: "Event",
          elementId: eventId,
        });
      }
      event = this.store.events.get(eventId)!.event;
    }
    return this.eventManager.emit(event, payload, "outside", options);
  }) as {
    <P>(
      event: IEvent<P> | string,
      payload?: P extends undefined | void ? undefined : P,
    ): Promise<void>;
    <P>(
      event: IEvent<P> | string,
      payload: P extends undefined | void ? undefined : P,
      options: IEventEmitOptions & { report: true },
    ): Promise<IEventEmitReport>;
    <P>(
      event: IEvent<P> | string,
      payload?: P extends undefined | void ? undefined : P,
      options?: IEventEmitOptions,
    ): Promise<void | IEventEmitReport>;
  };

  /**
   * Synchronously retrieves the initialized value of a resource.
   *
   * The resource must have been initialized (either at startup or via lazy loading).
   * For resources not initialized at startup, use `getLazyResourceValue()` instead.
   *
   * @param resource - The resource definition or resource ID string
   * @returns The initialized value of the resource (unwrapped if Promise-based)
   * @throws RuntimeError if resource not found, not initialized, or runtime disposed
   *
   * @example
   * // Get initialized resource
   * const db = runtime.getResourceValue(database);
   * const config = runtime.getResourceValue("app.config");
   */
  public getResourceValue = <Output extends Promise<any>>(
    /**
     * The resource to retrieve. Can be:
     * - A resource definition object (IResource)
     * - A resource ID string (for dynamic lookup)
     */
    resource: string | IResource<any, Output, any, any, any>,
  ): Output extends Promise<infer U> ? U : Output => {
    this.ensureRuntimeIsActive();

    const resourceId = this.getResourceId(resource);
    if (!this.store.resources.has(resourceId)) {
      runtimeElementNotFoundError.throw({
        type: "Resource",
        elementId: resourceId,
      });
    }
    if (
      this.lazyOptions.lazyMode &&
      this.lazyOptions.startupUnusedResourceIds?.has(resourceId)
    ) {
      lazyResourceSyncAccessError.throw({ id: resourceId });
    }

    return this.store.resources.get(resourceId)!.value;
  };

  /**
   * Initializes (if not already) and returns the value of a resource on-demand.
   *
   * This method is useful when:
   * - Lazy loading is enabled and the resource wasn't initialized at startup
   * - You need to access a resource that may not have been loaded yet
   * - You want to ensure initialization happens before access
   *
   * @param resource - The resource definition or resource ID string
   * @returns The initialized value of the resource (unwrapped if Promise-based)
   * @throws RuntimeError if resource not found or runtime disposed
   *
   * @example
   * // Lazy-load a resource on demand
   * const heavyService = await runtime.getLazyResourceValue(heavyService);
   */
  public getLazyResourceValue = async <Output extends Promise<any>>(
    /**
     * The resource to retrieve. Can be:
     * - A resource definition object (IResource)
     * - A resource ID string (for dynamic lookup)
     */
    resource: string | IResource<any, Output, any, any, any>,
  ): Promise<Output extends Promise<infer U> ? U : Output> => {
    this.ensureRuntimeIsActive();
    if (!this.lazyOptions.lazyMode) {
      lazyResourceAccessDisabledError.throw();
    }

    const resourceId = this.getResourceId(resource);
    if (!this.store.resources.has(resourceId)) {
      runtimeElementNotFoundError.throw({
        type: "Resource",
        elementId: resourceId,
      });
    }

    if (!this.lazyOptions.lazyResourceLoader) {
      return this.store.resources.get(resourceId)!.value;
    }

    return this.lazyOptions.lazyResourceLoader<
      Output extends Promise<infer U> ? U : Output
    >(resourceId);
  };

  /**
   * Retrieves the configuration that was passed to a resource.
   *
   * This returns the config object (the input), not the initialized value.
   * Use `getResourceValue()` to get the initialized value.
   *
   * @param resource - The resource definition or resource ID string
   * @returns The config object passed when registering the resource
   * @throws RuntimeError if resource not found or runtime disposed
   *
   * @example
   * const config = runtime.getResourceConfig(server);
   * // config = { port: 3000 }
   */
  public getResourceConfig = <Config>(
    /**
     * The resource to retrieve config from. Can be:
     * - A resource definition object (IResource)
     * - A resource ID string (for dynamic lookup)
     */
    resource: string | IResource<Config, any, any, any, any>,
  ): Config => {
    this.ensureRuntimeIsActive();

    const resourceId = typeof resource === "string" ? resource : resource.id;
    if (!this.store.resources.has(resourceId)) {
      runtimeElementNotFoundError.throw({
        type: "Resource",
        elementId: resourceId,
      });
    }

    return this.store.resources.get(resourceId)!.config;
  };

  /**
   * Returns the ID of the root resource.
   * @returns The root resource identifier
   *
   * @example
   * const rootId = runtime.getRootId(); // "app"
   */
  public getRootId = (): string => this.getRootOrThrow().resource.id;

  /**
   * Returns the configuration passed to the root resource.
   * @returns The root resource configuration
   *
   * @example
   * const config = runtime.getRootConfig<AppConfig>();
   */
  public getRootConfig = <Config = unknown>(): Config =>
    this.getRootOrThrow().config as Config;

  /**
   * Returns the initialized value of the root resource.
   *
   * This is the value returned by the root resource's `init` function.
   * The root must have been fully initialized before calling this.
   *
   * @returns The root resource's initialized value
   * @throws RuntimeError if root hasn't been initialized yet
   *
   * @example
   * const app = runtime.getRootValue<App>();
   */
  public getRootValue = <Value = unknown>(): Value => {
    const root = this.getRootOrThrow();
    if (root.isInitialized !== true) {
      runtimeRootNotInitializedError.throw({ rootId: root.resource.id });
    }

    return root.value as Value;
  };

  /**
   * Extracts the resource ID from a resource definition or string.
   * @internal
   */
  private getResourceId(
    resource: string | IResource<any, any, any, any, any>,
  ): string {
    return typeof resource === "string" ? resource : resource.id;
  }

  /**
   * Disposes the runtime and all registered resources.
   *
   * Disposal executes in reverse initialization order:
   * 1. All resource `dispose` methods are called
   * 2. Event listeners are cleared
   * 3. Async contexts are reset
   *
   * After disposal, any further operations will throw.
   * Safe to call multiple times (subsequent calls return immediately).
   *
   * @returns Promise that resolves when disposal is complete
   * @throws RuntimeError if called during bootstrap phase
   *
   * @example
   * await runtime.dispose();
   * // All resources cleaned up, runtime is now inactive
   */
  public dispose = () => {
    if (this.#isBootstrapping) {
      runResultDisposeDuringBootstrapError.throw();
    }

    if (this.#disposed) {
      return Promise.resolve();
    }

    if (this.#disposePromise) {
      return this.#disposePromise;
    }

    this.#disposing = true;

    this.#disposePromise = Promise.resolve()
      .then(() => this.disposeFn())
      .finally(() => {
        this.#disposed = true;
        this.#disposing = false;
        this.#disposePromise = undefined;
      });

    return this.#disposePromise;
  };
}
