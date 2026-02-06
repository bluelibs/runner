import {
  IResource,
  RegisterableItems,
  ITag,
  ITaskMiddleware,
  IResourceMiddleware,
  DependencyMapType,
} from "../defs";
import { findCircularDependencies } from "./utils/findCircularDependencies";
import { globalEventsArray } from "../globals/globalEvents";
import {
  circularDependenciesError,
  storeAlreadyInitializedError,
  eventEmissionCycleError,
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
import { isOptional, isResource } from "../define";

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
  }

  checkLock() {
    if (this.#isLocked) {
      throw new Error("Cannot modify the Store when it is locked.");
    }
  }

  private registerGlobalComponents() {
    if (!this.taskRunner) {
      throw new Error(
        "TaskRunner is not set. Call store.setTaskRunner() before initializeStore().",
      );
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

  private setupRootResource(rootDefinition: IResource<any>, config: any) {
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
      computedDependencies: {},
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
    config: any,
  ) {
    if (this.#isInitialized) {
      storeAlreadyInitializedError.throw({});
    }

    this.registerGlobalComponents();
    this.setupRootResource(root, config);
    this.validator.runSanityChecks();

    for (const resource of this.resources.values()) {
      this.overrideManager.storeOverridesDeeply(resource.resource);
    }

    this.#isInitialized = true;
  }

  public async dispose() {
    for (const resource of this.getResourcesInDisposeOrder()) {
      if (resource.isInitialized && resource.resource.dispose) {
        await resource.resource.dispose(
          resource.value,
          resource.config,
          resource.computedDependencies as unknown as DependencyMapType,
          resource.context,
        );
      }
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
    const initializedResources = Array.from(this.resources.values()).filter(
      (r) => r.isInitialized,
    );

    // Fast path: if the store tracked a complete init order, reverse it for disposal.
    // This is correct because initialization happens dependency-first, so dependents
    // always appear after their dependencies in the init sequence.
    const initOrderHasAllInitialized =
      this.initializedResourceIds.length === initializedResources.length &&
      initializedResources.every((r) =>
        this.initializedResourceIds.includes(r.resource.id),
      );
    if (initOrderHasAllInitialized) {
      const byId = new Map(
        initializedResources.map((r) => [r.resource.id, r] as const),
      );
      return this.initializedResourceIds
        .slice()
        .reverse()
        .map((id) => byId.get(id))
        .filter((r): r is ResourceStoreElementType => Boolean(r));
    }

    // Dispose order should be dependents-first (reverse init order).
    // We derive it from the resource dependency graph to make it stable
    // regardless of registration/insertion order.
    const visitState = new Map<string, "visiting" | "visited">();
    const initOrder: ResourceStoreElementType[] = [];
    let cycleDetected = false;

    const getDependencyIds = (resource: ResourceStoreElementType): string[] => {
      const raw = resource.resource.dependencies;
      if (!raw) return [];
      const deps = raw as unknown;
      if (!deps || typeof deps !== "object") return [];

      const out: string[] = [];
      const collect = (value: unknown): void => {
        if (isOptional(value)) {
          collect((value as { inner: unknown }).inner);
          return;
        }
        if (isResource(value)) {
          out.push(value.id);
        }
      };

      Object.values(deps as Record<string, unknown>).forEach(collect);
      return out;
    };

    const visit = (resourceId: string): void => {
      const state = visitState.get(resourceId);
      if (state === "visited") return;
      if (state === "visiting") {
        cycleDetected = true;
        return;
      }

      const resource = this.resources.get(resourceId);
      if (!resource) return;

      visitState.set(resourceId, "visiting");
      getDependencyIds(resource).forEach(visit);
      visitState.set(resourceId, "visited");
      initOrder.push(resource);
    };

    initializedResources.forEach((r) => visit(r.resource.id));

    // If a cycle sneaks in despite validation (or disposal is called on a
    // partially-initialized store), fall back to insertion order LIFO.
    if (cycleDetected) {
      return initializedResources.slice().reverse();
    }

    return initOrder.reverse();
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
  public getTasksWithTag(tag: string | ITag<any, any, any>) {
    return this.registry.getTasksWithTag(tag);
  }

  /**
   * Returns all resources with the given tag.
   * @param tag - The tag to filter by.
   * @returns The resources with the given tag.
   */
  public getResourcesWithTag(tag: string | ITag<any, any, any>) {
    return this.registry.getResourcesWithTag(tag);
  }
}
