import {
  IResource,
  RegisterableItems,
  ITag,
  AnyTask,
  ITaskMiddleware,
  IResourceMiddleware,
  TaggedTask,
  TaggedResource,
  AnyResource,
} from "../defs";
import { findCircularDependencies } from "./utils/findCircularDependencies";
import { globalEventsArray } from "../globals/globalEvents";
import {
  circularDependenciesError,
  storeAlreadyInitializedError,
  eventEmissionCycleError,
  lockedError,
  taskRunnerNotSetError,
} from "../errors";
import { EventManager } from "./EventManager";
import { Logger } from "./Logger";
import { StoreRegistry } from "./StoreRegistry";
import { OverrideManager } from "./OverrideManager";
import { StoreValidator } from "./StoreValidator";
import {
  ResourceStoreElementType,
  TaskStoreElementType,
  EventStoreElementType,
} from "../types/storeTypes";
import { TaskRunner } from "./TaskRunner";
import { globalResources } from "../globals/globalResources";
import { requireContextTaskMiddleware } from "../globals/middleware/requireContext.middleware";
import {
  retryTaskMiddleware,
  retryResourceMiddleware,
} from "../globals/middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  timeoutResourceMiddleware,
} from "../globals/middleware/timeout.middleware";
import {
  concurrencyTaskMiddleware,
  concurrencyResource,
} from "../globals/middleware/concurrency.middleware";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
  temporalResource,
} from "../globals/middleware/temporal.middleware";
import { fallbackTaskMiddleware } from "../globals/middleware/fallback.middleware";
import {
  rateLimitTaskMiddleware,
  rateLimitResource,
} from "../globals/middleware/rateLimit.middleware";
import {
  circuitBreakerMiddleware,
  circuitBreakerResource,
} from "../globals/middleware/circuitBreaker.middleware";
import { tunnelResourceMiddleware } from "../globals/middleware/tunnel.middleware";
import { OnUnhandledError } from "./UnhandledError";
import { globalTags } from "../globals/globalTags";
import { MiddlewareManager } from "./MiddlewareManager";
import { RunnerMode } from "../types/runner";
import { detectRunnerMode } from "../tools/detectRunnerMode";
import { Serializer } from "../serializer";
import { getResourcesInDisposeOrder as computeDisposeOrder } from "./utils/disposeOrder";
import { RunResult } from "./RunResult";
import { getAllThrows } from "../tools/getAllThrows";
import type { ITask } from "../types/task";

// Re-export types for backward compatibility
export type {
  ResourceStoreElementType,
  TaskStoreElementType,
  EventStoreElementType,
};

/**
 * Store class which is used to store all the resources, tasks, middleware and events.
 */
export class Store {
  root!: ResourceStoreElementType;
  private registry: StoreRegistry;
  private overrideManager: OverrideManager;
  private validator: StoreValidator;
  private taskRunner?: TaskRunner;
  private middlewareManager!: MiddlewareManager;
  private readonly initializedResourceIds: string[] = [];
  private preferInitOrderDisposal = true;

  #isLocked = false;
  #isInitialized = false;
  public mode: RunnerMode;

  constructor(
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
    public readonly onUnhandledError: OnUnhandledError,
    mode?: RunnerMode,
  ) {
    this.registry = new StoreRegistry(this);
    this.validator = this.registry.getValidator();
    this.overrideManager = new OverrideManager(this.registry);
    this.middlewareManager = new MiddlewareManager(this, eventManager, logger);

    this.mode = detectRunnerMode(mode);
  }

  // Delegate properties to registry
  get tasks() {
    return this.registry.tasks;
  }
  get hooks() {
    return this.registry.hooks;
  }
  get resources() {
    return this.registry.resources;
  }
  get events() {
    return this.registry.events;
  }
  get errors() {
    return this.registry.errors;
  }
  get asyncContexts() {
    return this.registry.asyncContexts;
  }
  get taskMiddlewares() {
    return this.registry.taskMiddlewares;
  }
  get resourceMiddlewares() {
    return this.registry.resourceMiddlewares;
  }
  get tags() {
    return this.registry.tags;
  }
  get overrides() {
    return this.overrideManager.overrides;
  }
  get overrideRequests() {
    return this.overrideManager.overrideRequests;
  }

  // Expose the shared MiddlewareManager instance so other components (like TaskRunner)
  // can compose runners using the same interceptor configuration.
  public getMiddlewareManager(): MiddlewareManager {
    return this.middlewareManager;
  }

  get isLocked() {
    return this.#isLocked;
  }

  lock() {
    this.#isLocked = true;
    this.registry.lockAll();
  }

  checkLock() {
    if (this.#isLocked) {
      lockedError.throw({ what: "Store" });
    }
  }

  private registerGlobalComponents(runtimeResult: RunResult<unknown>) {
    if (!this.taskRunner) {
      taskRunnerNotSetError.throw();
    }

    const builtInResourcesMap = new Map<
      IResource<any, any, any, any, any>,
      unknown
    >();
    builtInResourcesMap.set(globalResources.store, this);
    builtInResourcesMap.set(globalResources.eventManager, this.eventManager);
    builtInResourcesMap.set(globalResources.logger, this.logger);
    builtInResourcesMap.set(globalResources.taskRunner, this.taskRunner);
    builtInResourcesMap.set(globalResources.serializer, new Serializer());
    builtInResourcesMap.set(
      globalResources.middlewareManager,
      this.middlewareManager,
    );
    builtInResourcesMap.set(globalResources.runtime, runtimeResult);

    this.registry.storeGenericItem(globalResources.queue);
    this.registry.storeGenericItem(globalResources.httpClientFactory);

    for (const [resource, value] of builtInResourcesMap.entries()) {
      this.registry.storeGenericItem(resource);
      const entry = this.resources.get(resource.id);
      if (entry) {
        entry.value = value;
        entry.isInitialized = true;
        this.recordResourceInitialized(resource.id);
      }
    }

    // Register global tags
    Object.values(globalTags).forEach((tag) => {
      this.registry.storeTag(tag);
    });

    // Register global events
    globalEventsArray.forEach((event) => {
      this.registry.storeEvent(event);
    });

    // Register built-in middlewares
    // Built-in middlewares currently target tasks only; adjust as needed per kind
    const builtInTaskMiddlewares = [
      requireContextTaskMiddleware,
      retryTaskMiddleware,
      timeoutTaskMiddleware,
      concurrencyTaskMiddleware,
      debounceTaskMiddleware,
      throttleTaskMiddleware,
      fallbackTaskMiddleware,
      rateLimitTaskMiddleware,
      circuitBreakerMiddleware,
    ];
    builtInTaskMiddlewares.forEach((middleware) => {
      this.registry.taskMiddlewares.set(middleware.id, {
        middleware: middleware as unknown as ITaskMiddleware<any>,
        computedDependencies: {},
        isInitialized: false,
      });
    });

    const builtInResourceMiddlewares = [
      retryResourceMiddleware,
      timeoutResourceMiddleware,
      tunnelResourceMiddleware,
    ];
    builtInResourceMiddlewares.forEach((middleware) => {
      this.registry.resourceMiddlewares.set(middleware.id, {
        middleware: middleware as unknown as IResourceMiddleware<any>,
        computedDependencies: {},
        isInitialized: false,
      });
    });

    // Register built-in resources that support the middlewares
    this.registry.storeGenericItem(rateLimitResource);
    this.registry.storeGenericItem(circuitBreakerResource);
    this.registry.storeGenericItem(temporalResource);
    this.registry.storeGenericItem(concurrencyResource);
  }

  public setTaskRunner(taskRunner: TaskRunner) {
    this.taskRunner = taskRunner;
  }

  public setPreferInitOrderDisposal(prefer: boolean) {
    this.preferInitOrderDisposal = prefer;
  }

  private setupRootResource(rootDefinition: IResource<any>, config: unknown) {
    // Clone the root definition so per-run dependency/register resolution
    // never mutates the reusable user definition object.
    const root: IResource<any> = {
      ...rootDefinition,
      dependencies:
        typeof rootDefinition.dependencies === "function"
          ? rootDefinition.dependencies(config)
          : rootDefinition.dependencies,
    };

    this.root = {
      resource: root,
      computedDependencies: undefined,
      config,
      value: undefined,
      isInitialized: false,
      context: {},
    };

    this.registry.computeRegistrationDeeply(root, config);
    this.registry.resources.set(root.id, this.root);
  }

  public validateDependencyGraph() {
    // We verify that there isn't any circular dependencies before we begin computing the dependencies
    const dependentNodes = this.registry.getDependentNodes();
    const circularDependencies = findCircularDependencies(dependentNodes);
    if (circularDependencies.cycles.length > 0) {
      circularDependenciesError.throw({ cycles: circularDependencies.cycles });
    }
  }

  public validateEventEmissionGraph() {
    const eventNodes = this.registry.buildEventEmissionGraph();
    const circular = findCircularDependencies(eventNodes);
    if (circular.cycles.length > 0) {
      eventEmissionCycleError.throw({ cycles: circular.cycles });
    }
  }

  public initializeStore(
    root: IResource<any, any, any, any, any>,
    config: unknown,
    runtimeResult: RunResult<unknown>,
  ) {
    if (this.#isInitialized) {
      storeAlreadyInitializedError.throw();
    }

    this.registerGlobalComponents(runtimeResult);
    this.setupRootResource(root, config);
    this.validator.runSanityChecks();

    for (const resource of this.resources.values()) {
      this.overrideManager.storeOverridesDeeply(resource.resource);
    }

    this.#isInitialized = true;
  }

  public async dispose() {
    const disposalErrors: Error[] = [];

    for (const resource of this.getResourcesInDisposeOrder()) {
      try {
        if (resource.isInitialized && resource.resource.dispose) {
          await resource.resource.dispose(
            resource.value,
            resource.config,
            resource.computedDependencies ?? {},
            resource.context,
          );
        }
      } catch (error) {
        disposalErrors.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    this.clearRuntimeStateAfterDispose();
    this.eventManager.dispose();

    if (disposalErrors.length === 1) {
      throw disposalErrors[0];
    }

    if (disposalErrors.length > 1) {
      throw Object.assign(
        new Error("One or more resources failed to dispose."),
        {
          name: "AggregateError",
          errors: disposalErrors,
        },
      );
    }
  }

  public recordResourceInitialized(resourceId: string) {
    if (
      this.initializedResourceIds[this.initializedResourceIds.length - 1] ===
      resourceId
    ) {
      return;
    }
    if (this.initializedResourceIds.includes(resourceId)) {
      return;
    }
    this.initializedResourceIds.push(resourceId);
  }

  private getResourcesInDisposeOrder(): ResourceStoreElementType[] {
    return computeDisposeOrder(this.resources, this.initializedResourceIds, {
      preferInitOrderFastPath: this.preferInitOrderDisposal,
    });
  }

  private clearRuntimeStateAfterDispose() {
    for (const resource of this.resources.values()) {
      resource.value = undefined;
      resource.context = undefined;
      resource.computedDependencies = undefined;
      resource.isInitialized = false;
    }

    this.initializedResourceIds.length = 0;
  }

  /**
   * Internal, avoid using this method directly.
   */
  public processOverrides() {
    this.overrideManager.processOverrides();
  }

  /**
   * Internal, avoid using this method directly.
   * @param item
   * @returns
   */
  public storeGenericItem<C>(item: RegisterableItems) {
    return this.registry.storeGenericItem<C>(item);
  }

  /**
   * Returns all tasks with the given tag.
   * @param tag - The tag to filter by.
   * @returns The tasks with the given tag.
   */
  public getTasksWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedTask<TTag>[];
  public getTasksWithTag(tag: string): AnyTask[];
  public getTasksWithTag(tag: string | ITag<any, any, any>): AnyTask[] {
    return typeof tag === "string"
      ? this.registry.getTasksWithTag(tag)
      : this.registry.getTasksWithTag(tag);
  }

  /**
   * Returns all resources with the given tag.
   * @param tag - The tag to filter by.
   * @returns The resources with the given tag.
   */
  public getResourcesWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedResource<TTag>[];
  public getResourcesWithTag(tag: string): AnyResource[];
  public getResourcesWithTag(tag: string | ITag<any, any, any>): AnyResource[] {
    return typeof tag === "string"
      ? this.registry.getResourcesWithTag(tag)
      : this.registry.getResourcesWithTag(tag);
  }

  /**
   * Returns all error ids declared across a task or resource and its full
   * dependency chain: own throws, middleware throws (local + everywhere),
   * resource dependency throws, and — for tasks — hook throws on events
   * the task can emit. Deduplicated.
   */
  public getAllThrows(
    target: ITask<any, any, any, any, any, any> | IResource<any, any, any, any>,
  ): readonly string[] {
    return getAllThrows(this.registry, target);
  }
}
