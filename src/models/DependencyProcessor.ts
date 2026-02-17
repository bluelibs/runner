import {
  DependencyMapType,
  DependencyValuesType,
  ITask,
  IResource,
  IEvent,
  IEventEmission,
  IEventEmitOptions,
  TaskLocalInterceptor,
  ResourceDependencyValuesType,
  TaskDependencyWithIntercept,
  TaskCallOptions,
} from "../defs";
import { Store } from "./Store";
import {
  ResourceStoreElementType,
  TaskStoreElementType,
  HookStoreElementType,
  HookDependencyState,
} from "../types/storeTypes";
import * as utils from "../define";
import { EventManager } from "./EventManager";
import { ResourceInitializer } from "./ResourceInitializer";
import { TaskRunner } from "./TaskRunner";
import {
  dependencyNotFoundError,
  eventNotFoundError,
  unknownItemTypeError,
  parallelInitSchedulingError,
} from "../errors";
import { Logger } from "./Logger";
import { findDependencyStrategy } from "./utils/dependencyStrategies";
import { ResourceInitMode } from "../types/runner";
import { getResourceDependencyIds } from "./utils/resourceDependencyIds";

/**
 * Resolves and caches computed dependencies for store items (resources, tasks, middleware, hooks).
 */
export class DependencyProcessor {
  protected readonly resourceInitializer: ResourceInitializer;
  protected readonly logger!: Logger;
  protected readonly initMode: ResourceInitMode;
  protected readonly lazy: boolean;
  private readonly pendingHookEvents = new Map<string, IEventEmission<any>[]>();
  private readonly drainingHookIds = new Set<string>();
  private readonly inFlightResourceInitializations = new Map<
    string,
    Promise<void>
  >();

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly taskRunner: TaskRunner,
    logger: Logger,
    initMode: ResourceInitMode = ResourceInitMode.Sequential,
    lazy = false,
  ) {
    this.logger = logger.with({ source: "dependencyProcessor" });
    this.initMode = initMode;
    this.lazy = lazy;
    this.resourceInitializer = new ResourceInitializer(
      store,
      eventManager,
      logger,
    );
  }

  /**
   * Computes and caches dependencies for all registered store items.
   */
  async computeAllDependencies() {
    await this.computeResourceMiddlewareDependencies();
    await this.computeTaskMiddlewareDependencies();

    // Compute hook dependencies before traversing resource/task dependencies.
    // Resource/task dependency extraction can initialize resources that emit
    // events; hooks must be dependency-ready before that happens.
    await this.computeHookDependencies();

    if (!this.lazy && this.initMode === ResourceInitMode.Parallel) {
      await this.initializeUninitializedResourcesParallel();
    } else if (!this.lazy) {
      for (const resource of this.store.resources.values()) {
        await this.processResourceDependencies(resource);
      }
      // leftovers that were registered but not depended upon, except root
      // they should still be initialized as they might extend other
      await this.initializeUninitializedResources();
    }

    for (const task of this.store.tasks.values()) {
      await this.computeTaskDependencies(task);
    }

    await this.processResourceDependencies(this.store.root);
  }

  private async computeTaskDependencies(
    task: TaskStoreElementType<any, any, any>,
  ) {
    if (task.isInitialized) {
      return;
    }

    const deps = task.task.dependencies as DependencyMapType;
    task.computedDependencies = await this.extractDependencies(
      deps,
      task.task.id,
    );
    // Mark task as initialized so subsequent injections don't recompute using
    // a potentially lazy dependencies() function and lose computed values.
    task.isInitialized = true;
  }

  // Initialize non-root resources that are registered but not depended upon (side effects/disposers).
  public async initializeUninitializedResources() {
    for (const resource of this.store.resources.values()) {
      if (
        resource.isInitialized === false &&
        // The root is the last one to be initialized and is done in a separate process.
        resource.resource.id !== this.store.root.resource.id
      ) {
        await this.ensureResourceInitialized(resource);
      }
    }
  }

  private async computeResourceMiddlewareDependencies() {
    await Promise.all(
      Array.from(this.store.resourceMiddlewares.values()).map(
        async (middleware) => {
          const computedDependencies = await this.extractDependencies(
            middleware.middleware.dependencies,
            middleware.middleware.id,
          );

          middleware.computedDependencies = computedDependencies;
          middleware.isInitialized = true;
        },
      ),
    );
  }

  private async computeTaskMiddlewareDependencies() {
    await Promise.all(
      Array.from(this.store.taskMiddlewares.values()).map(
        async (middleware) => {
          const computedDependencies = await this.extractDependencies(
            middleware.middleware.dependencies,
            middleware.middleware.id,
          );

          middleware.computedDependencies = computedDependencies;
          middleware.isInitialized = true;
        },
      ),
    );
  }

  private async computeHookDependencies() {
    await Promise.all(
      Array.from(this.store.hooks.values()).map(async (hookStoreElement) => {
        const hook = hookStoreElement.hook;
        const deps = hook.dependencies as DependencyMapType;
        hookStoreElement.dependencyState = HookDependencyState.Computing;
        hookStoreElement.computedDependencies = await this.extractDependencies(
          deps,
          hook.id,
        );
        hookStoreElement.dependencyState = HookDependencyState.Ready;
        await this.flushBufferedHookEvents(hookStoreElement);
      }),
    );
  }

  private async initializeUninitializedResourcesParallel() {
    const rootId = this.store.root.resource.id;

    while (true) {
      const pending = Array.from(this.store.resources.values()).filter(
        (resource) =>
          resource.resource.id !== rootId && resource.isInitialized === false,
      );
      if (pending.length === 0) {
        return;
      }

      const readyWave = pending.filter((resource) =>
        this.isResourceReadyForParallelInit(resource),
      );

      if (readyWave.length === 0) {
        parallelInitSchedulingError.throw();
      }

      const results = await Promise.allSettled(
        readyWave.map((resource) => this.ensureResourceInitialized(resource)),
      );
      const failures = results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) =>
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason)),
        );

      if (failures.length === 1) {
        throw failures[0];
      }

      if (failures.length > 1) {
        throw Object.assign(
          new Error(
            `${failures.length} resources failed during parallel initialization.`,
          ),
          {
            name: "AggregateError",
            errors: failures,
          },
        );
      }
    }
  }

  private isResourceReadyForParallelInit(
    resource: ResourceStoreElementType<any, any, any>,
  ): boolean {
    const dependencyIds = getResourceDependencyIds(
      resource.resource.dependencies,
    );
    return dependencyIds.every((dependencyId) => {
      const dependencyResource = this.store.resources.get(dependencyId);
      return dependencyResource?.isInitialized === true;
    });
  }

  private async ensureResourceInitialized(
    resource: ResourceStoreElementType<any, any, any>,
  ) {
    if (resource.isInitialized) {
      return;
    }

    const resourceId = resource.resource.id;
    const existingInitialization =
      this.inFlightResourceInitializations.get(resourceId);
    if (existingInitialization) {
      await existingInitialization;
      return;
    }

    const initialization = (async () => {
      try {
        await this.processResourceDependencies(resource);
        const { value, context } =
          await this.resourceInitializer.initializeResource(
            resource.resource,
            resource.config,
            resource.computedDependencies!,
          );
        resource.context = context;
        resource.value = value;
        resource.isInitialized = true;
        this.store.recordResourceInitialized(resourceId);
      } catch (error: unknown) {
        this.rethrowResourceInitError(resourceId, error);
      }
    })();

    this.inFlightResourceInitializations.set(resourceId, initialization);

    try {
      await initialization;
    } finally {
      this.inFlightResourceInitializations.delete(resourceId);
    }
  }

  private rethrowResourceInitError(resourceId: string, error: unknown): never {
    const prefix = `Resource "${resourceId}" initialization failed`;
    if (error instanceof Error) {
      if (!error.message.includes(resourceId)) {
        error.message = `${prefix}: ${error.message}`;
      }
      if (!Object.prototype.hasOwnProperty.call(error, "resourceId")) {
        Object.defineProperty(error, "resourceId", {
          value: resourceId,
          configurable: true,
        });
      }
      if (!Object.prototype.hasOwnProperty.call(error, "cause")) {
        Object.defineProperty(error, "cause", {
          value: { resourceId },
          configurable: true,
        });
      }
      throw error;
    }

    const wrapper = new Error(`${prefix}: ${String(error)}`);
    Object.defineProperty(wrapper, "resourceId", {
      value: resourceId,
      configurable: true,
    });
    Object.defineProperty(wrapper, "cause", {
      value: error,
      configurable: true,
    });
    throw wrapper;
  }

  /**
   * Computes and caches dependencies for a resource (if not already computed).
   */
  protected async processResourceDependencies<TD extends DependencyMapType>(
    resource: ResourceStoreElementType<any, any, TD>,
  ) {
    if (resource.computedDependencies !== undefined) {
      return;
    }

    const deps = (resource.resource.dependencies || ({} as TD)) as TD;
    const extracted = await this.extractDependencies(
      deps,
      resource.resource.id,
    );

    resource.computedDependencies = this.wrapResourceDependencies<TD>(
      deps,
      extracted,
    );
    // resource.isInitialized = true;
  }

  private wrapResourceDependencies<TD extends DependencyMapType>(
    deps: TD,
    extracted: DependencyValuesType<TD>,
  ): ResourceDependencyValuesType<TD> {
    const wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(deps) as Array<keyof TD>) {
      const original = deps[key];
      const value = (extracted as Record<string, unknown>)[key as string];
      if (utils.isOptional(original)) {
        const inner = (original as { inner: unknown }).inner;
        if (utils.isTask(inner)) {
          wrapped[key as string] = value
            ? this.makeTaskWithIntercept(inner)
            : undefined;
        } else {
          wrapped[key as string] = value as unknown;
        }
        continue;
      }
      if (utils.isTask(original)) {
        wrapped[key as string] = this.makeTaskWithIntercept(original);
      } else {
        wrapped[key as string] = value as unknown;
      }
    }
    return wrapped as unknown as ResourceDependencyValuesType<TD>;
  }

  private makeTaskWithIntercept<
    I,
    O extends Promise<any>,
    D extends DependencyMapType,
  >(original: ITask<I, O, D>): TaskDependencyWithIntercept<I, O> {
    const taskId = original.id;
    const fn: (input: I, options?: TaskCallOptions) => O = (input, options) => {
      const storeTask = this.getStoreTaskOrThrow(taskId);
      const effective: ITask<I, O, D> = storeTask.task;

      return this.taskRunner.run(effective, input, options) as O;
    };
    return Object.assign(fn, {
      intercept: (middleware: TaskLocalInterceptor<I, O>) => {
        this.store.checkLock();
        const storeTask = this.getStoreTaskOrThrow(taskId);

        if (!storeTask.interceptors) storeTask.interceptors = [];
        storeTask.interceptors.push(middleware);
      },
    }) as unknown as TaskDependencyWithIntercept<I, O>;
  }

  private getStoreTaskOrThrow(
    taskId: string,
  ): TaskStoreElementType<any, any, any> {
    const storeTask = this.store.tasks.get(taskId);
    if (storeTask === undefined) {
      return dependencyNotFoundError.throw({ key: `Task ${taskId}` });
    }
    return storeTask;
  }

  public async initializeRoot() {
    await this.ensureResourceInitialized(this.store.root);
  }

  /**
   * Attaches listeners for all hooks. Must run before emitting events.
   */
  public attachListeners() {
    // Attach listeners for dedicated hooks map
    for (const hookStoreElement of this.store.hooks.values()) {
      const hook = hookStoreElement.hook;
      if (hook.on) {
        const eventDefinition = hook.on;

        const handler = async (receivedEvent: IEventEmission<any>) => {
          if (receivedEvent.source === hook.id) {
            return;
          }
          if (hookStoreElement.dependencyState !== HookDependencyState.Ready) {
            this.enqueueBufferedHookEvent(hook.id, receivedEvent);
            return;
          }
          await this.flushBufferedHookEvents(hookStoreElement);
          return this.eventManager.executeHookWithInterceptors(
            hook,
            receivedEvent,
            hookStoreElement.computedDependencies,
          );
        };

        const order = hook.order ?? 0;

        if (eventDefinition === "*") {
          this.eventManager.addGlobalListener(handler, { order });
        } else if (Array.isArray(eventDefinition)) {
          for (const e of eventDefinition) {
            if (this.store.events.get(e.id) === undefined) {
              eventNotFoundError.throw({ id: e.id });
            }
          }
          this.eventManager.addListener(
            eventDefinition as unknown as IEvent[],
            handler,
            {
              order,
            },
          );
        } else {
          if (this.store.events.get(eventDefinition.id) === undefined) {
            eventNotFoundError.throw({ id: eventDefinition.id });
          }
          this.eventManager.addListener(
            eventDefinition as unknown as IEvent,
            handler,
            {
              order,
            },
          );
        }
      }
    }
  }

  private enqueueBufferedHookEvent(
    hookId: string,
    event: IEventEmission<any>,
  ): void {
    const queue = this.pendingHookEvents.get(hookId);
    if (queue) {
      queue.push(event);
      return;
    }
    this.pendingHookEvents.set(hookId, [event]);
  }

  private async flushBufferedHookEvents(
    hookStoreElement: HookStoreElementType,
  ): Promise<void> {
    if (hookStoreElement.dependencyState !== HookDependencyState.Ready) {
      return;
    }

    const hook = hookStoreElement.hook;
    if (this.drainingHookIds.has(hook.id)) {
      return;
    }

    if (!this.pendingHookEvents.has(hook.id)) {
      return;
    }

    this.drainingHookIds.add(hook.id);
    try {
      while (true) {
        const queue = this.pendingHookEvents.get(hook.id);
        if (!queue || queue.length === 0) {
          this.pendingHookEvents.delete(hook.id);
          break;
        }
        this.pendingHookEvents.delete(hook.id);

        for (const queuedEvent of queue) {
          if (queuedEvent.source === hook.id) {
            continue;
          }
          await this.eventManager.executeHookWithInterceptors(
            hook,
            queuedEvent,
            hookStoreElement.computedDependencies,
          );
        }
      }
    } finally {
      this.drainingHookIds.delete(hook.id);
    }
  }

  async extractDependencies<T extends DependencyMapType>(
    map: T,
    source: string,
  ): Promise<DependencyValuesType<T>> {
    const object = {} as DependencyValuesType<T>;

    for (const key in map) {
      try {
        object[key] = await this.extractDependency(map[key], source);
        // Special handling, a little bit of magic and memory sacrifice for the sake of observability.
        // Maybe later we can allow this to be opt-in to save 'memory' in the case of large tasks?
        const val = object[key] as unknown;
        if (val instanceof Logger) {
          (object as Record<string, unknown>)[key] = val.with({ source });
        }
      } catch (e) {
        const errorMessage = String(e);
        this.logger.error(
          `Failed to extract dependency from source: ${source} -> ${key} with error: ${errorMessage}`,
        );

        throw e;
      }
    }
    this.logger.trace(`Finished computing dependencies for source: ${source}`);

    return object;
  }

  async extractDependency(object: unknown, source: string) {
    this.logger.trace(
      `Extracting dependency -> ${source} -> ${(object as { id?: string })?.id}`,
    );

    let isOpt = false;
    let item: unknown = object;

    if (utils.isOptional(object)) {
      isOpt = true;
      item = object.inner;
    }

    const itemWithId = item as { id: string };
    const strategy = findDependencyStrategy(item);
    if (!strategy) {
      return unknownItemTypeError.throw({ item });
    }

    // For optional deps, check existence first
    if (isOpt) {
      const exists = strategy.getStoreMap(this.store).has(itemWithId.id);
      if (!exists) return undefined;
    }

    // Dispatch to the appropriate extraction method
    if (utils.isResource(item)) return this.extractResourceDependency(item);
    if (utils.isTask(item)) return this.extractTaskDependency(item);
    if (utils.isEvent(item)) return this.extractEventDependency(item, source);

    // Errors and async contexts are their own value
    // For non-optional deps, verify they exist in the store
    if (!isOpt) {
      const exists = strategy.getStoreMap(this.store).has(itemWithId.id);
      if (!exists) {
        const label = utils.isError(item) ? "Error" : "AsyncContext";
        dependencyNotFoundError.throw({ key: `${label} ${itemWithId.id}` });
      }
    }

    return item;
  }

  /**
   * Converts the event into a running functions with real inputs
   * @param object
   * @returns
   */
  extractEventDependency(object: IEvent<any>, source: string) {
    return async (input: any, options?: IEventEmitOptions) => {
      return this.eventManager.emit(object, input, source, options);
    };
  }

  async extractTaskDependency(object: ITask<any, any, {}>) {
    const storeTask = this.store.tasks.get(object.id);
    if (storeTask === undefined) {
      dependencyNotFoundError.throw({ key: `Task ${object.id}` });
    }

    const st = storeTask!;
    if (!st.isInitialized) {
      // it's sanitised
      const dependencies = st.task.dependencies as DependencyMapType;

      st.computedDependencies = await this.extractDependencies(
        dependencies,
        st.task.id,
      );
      st.isInitialized = true;
    }

    return (input: unknown, options?: TaskCallOptions) => {
      return this.taskRunner.run(st.task, input, options);
    };
  }

  async extractResourceDependency(object: IResource<any, any, any>) {
    // check if it exists in the store with the value
    const storeResource = this.store.resources.get(object.id);
    if (storeResource === undefined) {
      dependencyNotFoundError.throw({ key: `Resource ${object.id}` });
    }

    const sr = storeResource!;
    await this.ensureResourceInitialized(sr);

    return sr.value;
  }
}
