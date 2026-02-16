import {
  DependencyMapType,
  DependencyValuesType,
  ITask,
  IResource,
  IEvent,
  IEventEmission,
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
} from "../errors";
import { Logger } from "./Logger";
import { findDependencyStrategy } from "./utils/dependencyStrategies";

/**
 * Resolves and caches computed dependencies for store items (resources, tasks, middleware, hooks).
 */
export class DependencyProcessor {
  protected readonly resourceInitializer: ResourceInitializer;
  protected readonly logger!: Logger;
  private readonly pendingHookEvents = new Map<string, IEventEmission<any>[]>();
  private readonly drainingHookIds = new Set<string>();

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly taskRunner: TaskRunner,
    logger: Logger,
  ) {
    this.logger = logger.with({ source: "dependencyProcessor" });
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
    for (const middleware of this.store.resourceMiddlewares.values()) {
      const computedDependencies = await this.extractDependencies(
        middleware.middleware.dependencies,
        middleware.middleware.id,
      );

      middleware.computedDependencies = computedDependencies;
      middleware.isInitialized = true;
    }

    for (const middleware of this.store.taskMiddlewares.values()) {
      const computedDependencies = await this.extractDependencies(
        middleware.middleware.dependencies,
        middleware.middleware.id,
      );

      middleware.computedDependencies = computedDependencies;
      middleware.isInitialized = true;
    }

    // Compute hook dependencies before traversing resource/task dependencies.
    // Resource/task dependency extraction can initialize resources that emit
    // events; hooks must be dependency-ready before that happens.
    for (const hookStoreElement of this.store.hooks.values()) {
      const hook = hookStoreElement.hook;
      const deps = hook.dependencies as DependencyMapType;
      hookStoreElement.dependencyState = HookDependencyState.Computing;
      hookStoreElement.computedDependencies = await this.extractDependencies(
        deps,
        hook.id,
      );
      hookStoreElement.dependencyState = HookDependencyState.Ready;
      await this.flushBufferedHookEvents(hookStoreElement);
    }

    for (const resource of this.store.resources.values()) {
      await this.processResourceDependencies(resource);
    }

    for (const task of this.store.tasks.values()) {
      await this.computeTaskDependencies(task);
    }

    // leftovers that were registered but not depended upon, except root
    // they should still be initialized as they might extend other
    await this.initializeUninitializedResources();
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
          this.store.recordResourceInitialized(resource.resource.id);
        } catch (error: unknown) {
          this.rethrowResourceInitError(resource.resource.id, error);
        }
      }
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
    const rootResource = this.store.root;

    const { value, context } =
      await this.resourceInitializer.initializeResource(
        rootResource.resource,
        rootResource.config,
        // They are already computed
        rootResource.computedDependencies!,
      );

    rootResource.context = context;
    rootResource.value = value;
    rootResource.isInitialized = true;
    this.store.recordResourceInitialized(rootResource.resource.id);
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
    return async (input: any) => {
      return this.eventManager.emit(object, input, source);
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
    const { resource, config } = sr;

    if (!sr.isInitialized) {
      const depMap = (resource.dependencies || {}) as DependencyMapType;

      let wrapped =
        sr.computedDependencies as ResourceDependencyValuesType<any>;

      // If not already computed, compute and cache it!
      if (wrapped === undefined) {
        const raw = await this.extractDependencies(depMap, resource.id);
        wrapped = this.wrapResourceDependencies(depMap, raw);
        sr.computedDependencies = wrapped;
      }

      try {
        const { value, context } =
          await this.resourceInitializer.initializeResource(
            resource,
            config,
            wrapped,
          );

        sr.context = context;
        sr.value = value;

        // we need to initialize the resource
        sr.isInitialized = true;
        this.store.recordResourceInitialized(resource.id);
      } catch (error: unknown) {
        this.rethrowResourceInitError(resource.id, error);
      }
    }

    return sr.value;
  }
}
