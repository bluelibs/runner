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
  validationError,
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
  DisposeWave,
  InitWave,
} from "../types/storeTypes";
import { TaskRunner } from "./TaskRunner";
import { globalResources } from "../globals/globalResources";
import { OnUnhandledError } from "./UnhandledError";
import { MiddlewareManager } from "./MiddlewareManager";
import { RunnerMode } from "../types/runner";
import { detectRunnerMode } from "../tools/detectRunnerMode";
import { Serializer } from "../serializer";
import { getResourcesInDisposeWaves as computeDisposeWaves } from "./utils/disposeOrder";
import { RunResult } from "./RunResult";
import { registerStoreBuiltins } from "./BuiltinsRegistry";
import type { RuntimeCallSource } from "../types/runtimeSource";
import {
  LifecycleAdmissionController,
  RuntimeLifecyclePhase,
} from "./runtime/LifecycleAdmissionController";

// Re-export types for backward compatibility
export type {
  ResourceStoreElementType,
  TaskStoreElementType,
  EventStoreElementType,
  InitWave,
  DisposeWave,
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
  private readonly initWaves: InitWave[] = [];
  private readonly initializedResourceIds = new Set<string>();
  private readonly pendingCooldownErrors: Error[] = [];
  private hasRunCooldown = false;
  private readonly lifecycleAdmissionController: LifecycleAdmissionController;

  #isLocked = false;
  #isInitialized = false;
  public mode: RunnerMode;

  constructor(
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
    public readonly onUnhandledError: OnUnhandledError,
    mode?: RunnerMode,
    lifecycleAdmissionController?: LifecycleAdmissionController,
  ) {
    this.lifecycleAdmissionController =
      lifecycleAdmissionController ?? new LifecycleAdmissionController();
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

  public getLifecycleAdmissionController(): LifecycleAdmissionController {
    return this.lifecycleAdmissionController;
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
   * Returns the owner resource id that directly registered the given item.
   */
  public getOwnerResourceId(itemId: string): string | undefined {
    return this.registry.visibilityTracker.getOwnerResourceId(itemId);
  }

  public resolveDefinitionId(reference: unknown): string | undefined {
    return this.registry.resolveDefinitionId(reference);
  }

  /**
   * Checks whether an item belongs to a resource registration subtree (or is
   * the resource itself).
   */
  public isItemWithinResourceSubtree(
    resourceId: string,
    itemId: string,
  ): boolean {
    return this.registry.visibilityTracker.isWithinResourceSubtree(
      resourceId,
      itemId,
    );
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

  public isInShutdownLockdown() {
    return this.lifecycleAdmissionController.isShutdownLockdown();
  }

  public canAdmitTaskCall(source: RuntimeCallSource): boolean {
    return this.lifecycleAdmissionController.canAdmitTask(source);
  }

  public beginDisposing() {
    if (
      this.lifecycleAdmissionController.getPhase() !==
      RuntimeLifecyclePhase.Running
    ) {
      return;
    }
    this.eventManager.enterShutdownLockdown();
    this.lifecycleAdmissionController.beginDisposing();
  }

  public beginDrained() {
    this.lifecycleAdmissionController.beginDrained();
  }

  public async waitForDrain(disposeDrainBudgetMs: number): Promise<boolean> {
    return this.lifecycleAdmissionController.waitForDrain(disposeDrainBudgetMs);
  }

  public markDisposed() {
    this.lifecycleAdmissionController.markDisposed();
  }

  public enterShutdownLockdown() {
    this.beginDisposing();
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

  private setupRootResource(rootDefinition: IResource<any>, config: unknown) {
    const resolvedDependencies =
      typeof rootDefinition.dependencies === "function"
        ? rootDefinition.dependencies(config)
        : rootDefinition.dependencies;

    if (
      resolvedDependencies !== undefined &&
      (resolvedDependencies === null ||
        typeof resolvedDependencies !== "object" ||
        Array.isArray(resolvedDependencies))
    ) {
      validationError.throw({
        subject: "Dependencies",
        id: rootDefinition.id,
        originalError:
          "Dependencies must be an object map. If you use dependencies as a function, it must return an object.",
      });
    }

    const dependenciesObject = (resolvedDependencies || {}) as Record<
      string,
      unknown
    >;

    // Clone the root definition so per-run dependency/register resolution
    // never mutates the reusable user definition object.
    const root: IResource<any> = {
      ...rootDefinition,
      dependencies: dependenciesObject,
      subtree: rootDefinition.subtree,
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
    this.registry.visibilityTracker.recordIsolation(root.id, root.isolate);
    this.registry.registerDefinitionAlias(rootDefinition, root.id);
    this.registry.registerDefinitionAlias(root, root.id);
    this.validator.checkIfIDExists(root.id);
    this.validator.trackRegisteredId(root.id);

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

    const overrideTraversalVisited = new Set<string>();
    for (const resource of this.resources.values()) {
      this.overrideManager.storeOverridesDeeply(
        resource.resource,
        overrideTraversalVisited,
      );
    }

    this.#isInitialized = true;
  }

  public async dispose() {
    const disposalErrors: Error[] = [...this.pendingCooldownErrors];

    for (const wave of this.getResourcesInDisposeWaves()) {
      const waveErrors = await this.disposeWave(wave);
      disposalErrors.push(...waveErrors);
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
    if (this.initializedResourceIds.has(resourceId)) {
      return;
    }
    this.initializedResourceIds.add(resourceId);
    this.initWaves.push({
      resourceIds: [resourceId],
      parallel: false,
    });
  }

  public recordInitWave(resourceIds: readonly string[]) {
    const uniqueResourceIds = Array.from(
      new Set(resourceIds.filter((id) => !this.initializedResourceIds.has(id))),
    );
    if (uniqueResourceIds.length === 0) {
      return;
    }

    for (const resourceId of uniqueResourceIds) {
      this.initializedResourceIds.add(resourceId);
    }

    this.initWaves.push({
      resourceIds: uniqueResourceIds,
      parallel: uniqueResourceIds.length > 1,
    });
  }

  private getResourcesInDisposeWaves(): DisposeWave[] {
    return computeDisposeWaves(this.resources, this.initWaves);
  }

  public async cooldown() {
    if (this.hasRunCooldown) {
      return;
    }

    this.hasRunCooldown = true;
    this.pendingCooldownErrors.length = 0;

    for (const wave of this.getResourcesInDisposeWaves()) {
      const waveErrors = await this.cooldownWave(wave);
      this.pendingCooldownErrors.push(...waveErrors);
    }
  }

  private clearRuntimeStateAfterDispose() {
    for (const resource of this.resources.values()) {
      resource.value = undefined;
      resource.context = undefined;
      resource.computedDependencies = undefined;
      resource.isInitialized = false;
    }

    this.initWaves.length = 0;
    this.initializedResourceIds.clear();
    this.pendingCooldownErrors.length = 0;
    this.hasRunCooldown = false;
    this.markDisposed();
  }

  private async cooldownWave(wave: DisposeWave): Promise<Error[]> {
    const normalizeError = (error: unknown): Error =>
      error instanceof Error ? error : new Error(String(error));
    const collectWaveErrors = (
      results: readonly PromiseSettledResult<void>[],
    ): Error[] =>
      results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => normalizeError(result.reason));

    if (wave.parallel) {
      const results = await Promise.allSettled(
        wave.resources.map((resource) => this.cooldownResource(resource)),
      );
      return collectWaveErrors(results);
    }

    const errors: Error[] = [];
    for (const resource of wave.resources) {
      try {
        await this.cooldownResource(resource);
      } catch (error) {
        errors.push(normalizeError(error));
      }
    }
    return errors;
  }

  private async disposeWave(wave: DisposeWave): Promise<Error[]> {
    const normalizeError = (error: unknown): Error =>
      error instanceof Error ? error : new Error(String(error));
    const collectWaveErrors = (
      results: readonly PromiseSettledResult<void>[],
    ): Error[] =>
      results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => normalizeError(result.reason));

    if (wave.parallel) {
      const results = await Promise.allSettled(
        wave.resources.map((resource) => this.disposeResource(resource)),
      );
      return collectWaveErrors(results);
    }

    const errors: Error[] = [];
    for (const resource of wave.resources) {
      try {
        await this.disposeResource(resource);
      } catch (error) {
        errors.push(normalizeError(error));
      }
    }
    return errors;
  }

  private async disposeResource(
    resource: ResourceStoreElementType,
  ): Promise<void> {
    if (!resource.isInitialized || !resource.resource.dispose) {
      return;
    }

    await resource.resource.dispose(
      resource.value,
      resource.config,
      resource.computedDependencies ?? {},
      resource.context,
    );
  }

  private async cooldownResource(
    resource: ResourceStoreElementType,
  ): Promise<void> {
    if (!resource.isInitialized || !resource.resource.cooldown) {
      return;
    }

    await resource.resource.cooldown(
      resource.value,
      resource.config,
      resource.computedDependencies ?? {},
      resource.context,
    );
  }

  /**
   * Internal, avoid using this method directly.
   */
  public processOverrides() {
    this.overrideManager.processOverrides();
    this.validator.runSanityChecks();
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
}
