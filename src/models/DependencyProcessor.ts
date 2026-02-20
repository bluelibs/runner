import {
  DependencyMapType,
  DependencyValuesType,
  IEvent,
  IEventEmission,
  IEventEmitOptions,
  IResource,
  ITask,
  ResourceDependencyValuesType,
} from "../defs";
import { Store } from "./Store";
import {
  ResourceStoreElementType,
  TaskStoreElementType,
  HookStoreElementType,
  HookDependencyState,
} from "../types/storeTypes";
import { EventManager } from "./EventManager";
import { ResourceInitializer } from "./ResourceInitializer";
import { TaskRunner } from "./TaskRunner";
import { eventNotFoundError } from "../errors";
import { Logger } from "./Logger";
import { ResourceInitMode } from "../types/runner";
import { DependencyExtractor } from "./dependency-processor/DependencyExtractor";
import { HookEventBuffer } from "./dependency-processor/HookEventBuffer";
import { ResourceScheduler } from "./dependency-processor/ResourceScheduler";

/**
 * Resolves and caches computed dependencies for store items (resources, tasks, middleware, hooks).
 */
export class DependencyProcessor {
  protected readonly resourceInitializer: ResourceInitializer;
  protected readonly dependencyExtractor: DependencyExtractor;
  protected readonly hookEventBuffer: HookEventBuffer;
  protected readonly resourceScheduler: ResourceScheduler;
  protected readonly logger!: Logger;
  protected readonly initMode: ResourceInitMode;
  protected readonly lazy: boolean;
  public readonly pendingHookEvents: Map<string, IEventEmission<any>[]>;
  public readonly drainingHookIds: Set<string>;
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
    runtimeEventCycleDetection = true,
  ) {
    this.logger = logger.with({ source: "dependencyProcessor" });
    this.initMode = initMode;
    this.lazy = lazy;
    this.resourceInitializer = new ResourceInitializer(
      store,
      eventManager,
      logger,
    );
    this.hookEventBuffer = new HookEventBuffer(
      eventManager,
      this.logger,
      runtimeEventCycleDetection,
    );
    this.pendingHookEvents = this.hookEventBuffer.pendingHookEvents;
    this.drainingHookIds = this.hookEventBuffer.drainingHookIds;
    this.dependencyExtractor = new DependencyExtractor(
      store,
      eventManager,
      taskRunner,
      this.logger,
      async (resource) => this.ensureResourceInitialized(resource),
    );
    this.resourceScheduler = new ResourceScheduler(store, async (resource) =>
      this.ensureResourceInitialized(resource),
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

    if (this.initMode === ResourceInitMode.Parallel && this.lazy) {
      await this.initializeStartupRequiredResourcesParallel();
    } else if (!this.lazy && this.initMode === ResourceInitMode.Parallel) {
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

  private async initializeStartupRequiredResourcesParallel() {
    const requiredResourceIds = this.collectStartupRequiredResourceIds();
    if (requiredResourceIds.size === 0) {
      return;
    }

    await this.initializeUninitializedResourcesParallel(requiredResourceIds);
  }

  private collectStartupRequiredResourceIds(): Set<string> {
    return this.resourceScheduler.collectStartupRequiredResourceIds();
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

  private async initializeUninitializedResourcesParallel(
    targetResourceIds?: ReadonlySet<string>,
  ) {
    await this.resourceScheduler.initializeUninitializedResourcesParallel(
      targetResourceIds,
    );
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
        this.resetResourceInitializationState(resource);
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

  private resetResourceInitializationState(
    resource: ResourceStoreElementType<any, any, any>,
  ): void {
    resource.context = undefined;
    resource.value = undefined;
    resource.isInitialized = false;
    resource.computedDependencies = undefined;
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
      resource.resource.id,
    );
    // resource.isInitialized = true;
  }

  private wrapResourceDependencies<TD extends DependencyMapType>(
    deps: TD,
    extracted: DependencyValuesType<TD>,
    ownerResourceId: string,
  ): ResourceDependencyValuesType<TD> {
    return this.dependencyExtractor.wrapResourceDependencies(
      deps,
      extracted,
      ownerResourceId,
    );
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
          this.eventManager.addListener(eventDefinition as IEvent[], handler, {
            order,
          });
        } else {
          if (this.store.events.get(eventDefinition.id) === undefined) {
            eventNotFoundError.throw({ id: eventDefinition.id });
          }
          this.eventManager.addListener(eventDefinition as IEvent, handler, {
            order,
          });
        }
      }
    }
  }

  private enqueueBufferedHookEvent(
    hookId: string,
    event: IEventEmission<any>,
  ): void {
    this.hookEventBuffer.enqueue(hookId, event);
  }

  private async flushBufferedHookEvents(
    hookStoreElement: HookStoreElementType,
  ): Promise<void> {
    await this.hookEventBuffer.flush(hookStoreElement);
  }

  async extractDependencies<T extends DependencyMapType>(
    map: T,
    source: string,
  ): Promise<DependencyValuesType<T>> {
    return this.dependencyExtractor.extractDependencies(map, source);
  }

  async extractDependency(object: unknown, source: string) {
    return this.dependencyExtractor.extractDependency(object, source);
  }

  /**
   * Converts the event into a running functions with real inputs
   * @param object
   * @returns
   */
  extractEventDependency(object: IEvent<any>, source: string) {
    return this.dependencyExtractor.extractEventDependency(object, source) as (
      input: any,
      options?: IEventEmitOptions,
    ) => Promise<any>;
  }

  async extractTaskDependency(object: ITask<any, any, {}>) {
    return this.dependencyExtractor.extractTaskDependency(object);
  }

  async extractResourceDependency(object: IResource<any, any, any>) {
    return this.dependencyExtractor.extractResourceDependency(object);
  }
}
