import {
  IResource,
  RegisterableItems,
  ITag,
  AnyTask,
  TaggedTask,
  TaggedResource,
  TagDependencyAccessor,
  AnyResource,
} from "../defs";
import { findCircularDependencies } from "./utils/findCircularDependencies";
import {
  circularDependencyError,
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
import { OnUnhandledError } from "./UnhandledError";
import { MiddlewareManager } from "./MiddlewareManager";
import { RunnerMode } from "../types/runner";
import { detectRunnerMode } from "../tools/detectRunnerMode";
import { Serializer } from "../serializer";
import { getResourcesInDisposeOrder as computeDisposeOrder } from "./utils/disposeOrder";
import { RunResult } from "./RunResult";
import { getAllThrows } from "../tools/getAllThrows";
import type { ITask } from "../types/task";
import { registerStoreBuiltins } from "./BuiltinsRegistry";

const INTERNAL_ROOT_CRON_DEPENDENCY_KEY = "__runnerCron";

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

  /**
   * Checks whether a registered item is visible to a consumer id under the
   * current exports visibility model.
   */
  public isItemVisibleToConsumer(
    targetId: string,
    consumerId: string,
  ): boolean {
    return this.registry.visibilityTracker.isAccessible(targetId, consumerId);
  }

  /**
   * Returns accessibility info for a target id against the root's export surface.
   * Used by the runtime API (runTask, emitEvent, getResourceValue, etc.) to enforce
   * that callers can only reach items the root resource has explicitly exported.
   */
  public getRootAccessInfo(
    targetId: string,
    rootId: string,
  ): { accessible: boolean; exportedIds: string[] } {
    return this.registry.visibilityTracker.getRootAccessInfo(targetId, rootId);
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

    for (const [resource, value] of builtInResourcesMap.entries()) {
      this.registry.storeGenericItem(resource);
      const entry = this.resources.get(resource.id);
      if (entry) {
        entry.value = value;
        entry.isInitialized = true;
        this.recordResourceInitialized(resource.id);
      }
    }
    registerStoreBuiltins(this.registry);
  }

  public setTaskRunner(taskRunner: TaskRunner) {
    this.taskRunner = taskRunner;
  }

  public setPreferInitOrderDisposal(prefer: boolean) {
    this.preferInitOrderDisposal = prefer;
  }

  private setupRootResource(rootDefinition: IResource<any>, config: unknown) {
    const resolvedDependencies =
      typeof rootDefinition.dependencies === "function"
        ? rootDefinition.dependencies(config)
        : rootDefinition.dependencies;

    const dependenciesObject = (resolvedDependencies || {}) as Record<
      string,
      unknown
    >;

    const rootDependencies = {
      ...dependenciesObject,
      [INTERNAL_ROOT_CRON_DEPENDENCY_KEY]:
        dependenciesObject[INTERNAL_ROOT_CRON_DEPENDENCY_KEY] ||
        globalResources.cron,
    };

    // Clone the root definition so per-run dependency/register resolution
    // never mutates the reusable user definition object.
    const root: IResource<any> = {
      ...rootDefinition,
      dependencies: rootDependencies,
    };

    this.root = {
      resource: root,
      computedDependencies: undefined,
      config,
      value: undefined,
      isInitialized: false,
      context: {},
    };

    this.registry.visibilityTracker.recordResource(root.id);
    this.registry.visibilityTracker.recordDefinitionTags(root.id, root.tags);
    this.registry.visibilityTracker.recordWiringAccessPolicy(
      root.id,
      root.wiringAccessPolicy,
    );

    this.registry.computeRegistrationDeeply(root, config);
    this.registry.resources.set(root.id, this.root);
  }

  public validateDependencyGraph() {
    // We verify that there isn't any circular dependencies before we begin computing the dependencies
    const dependentNodes = this.registry.getDependentNodes();
    const circularDependencies = findCircularDependencies(dependentNodes);
    if (circularDependencies.cycles.length > 0) {
      circularDependencyError.throw({ cycles: circularDependencies.cycles });
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
          cause: disposalErrors[0],
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

  public getTagAccessor<TTag extends ITag<any, any, any>>(
    tag: TTag,
    options?: { consumerId?: string; includeSelf?: boolean },
  ): TagDependencyAccessor<TTag> {
    return this.registry.getTagAccessor(tag, options);
  }

  /**
   * Returns all tasks with the given tag.
   * @param tag - The tag to filter by.
   * @returns The tasks with the given tag.
   * @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor.
   */
  public getTasksWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedTask<TTag>[];
  /** @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor. */
  public getTasksWithTag(tag: string): AnyTask[];
  /** @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor. */
  public getTasksWithTag(tag: string | ITag<any, any, any>): AnyTask[] {
    return typeof tag === "string"
      ? this.registry.getTasksWithTag(tag)
      : this.registry.getTasksWithTag(tag);
  }

  /**
   * Returns all resources with the given tag.
   * @param tag - The tag to filter by.
   * @returns The resources with the given tag.
   * @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor.
   */
  public getResourcesWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedResource<TTag>[];
  /** @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor. */
  public getResourcesWithTag(tag: string): AnyResource[];
  /** @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor. */
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
