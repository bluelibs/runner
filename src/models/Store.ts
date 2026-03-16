import {
  IEvent,
  IEventEmissionCallOptions,
  IResource,
  IsolationChannel,
  ITag,
  RegisterableItem,
  TagDependencyAccessor,
} from "../defs";
import { findCircularDependencies } from "./utils/findCircularDependencies";
import {
  circularDependencyError,
  resourceCooldownAdmissionTargetInvalidError,
  lazyResourceShutdownAccessError,
  storeAlreadyInitializedError,
  eventEmissionCycleError,
  lockedError,
  runtimeElementNotFoundError,
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
import type { RuntimeCallSource } from "../types/runtimeSource";
import { TaskRunner } from "./TaskRunner";
import { globalResources } from "../globals/globalResources";
import { OnUnhandledError } from "./UnhandledError";
import { MiddlewareManager } from "./MiddlewareManager";
import { RunnerMode } from "../types/runner";
import { detectRunnerMode } from "../tools/detectRunnerMode";
import { Serializer } from "../serializer";
import {
  getResourcesInDisposeWaves as computeDisposeWaves,
  getResourcesInReadyWaves as computeReadyWaves,
} from "./utils/disposeOrder";
import { RunResult } from "./RunResult";
import {
  LifecycleAdmissionController,
  RuntimeLifecyclePhase,
} from "./runtime/LifecycleAdmissionController";
import { createSyntheticFrameworkRoot } from "./createSyntheticFrameworkRoot";
import type { DebugFriendlyConfig } from "../globals/resources/debug";
import type { ResourceCooldownAdmissionTargets } from "../types/resource";
import { Match, check } from "../tools/check/engine";
import { StoreLookup, resolveRequestedIdFromStore } from "./StoreLookup";
import { ExecutionContextStore } from "./ExecutionContextStore";
import { resolveExecutionContextConfig } from "../tools/resolveExecutionContextConfig";
import type { AccessViolation } from "./VisibilityTracker";

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
  public readonly lookup: StoreLookup;
  private overrideManager: OverrideManager;
  private validator: StoreValidator;
  private taskRunner?: TaskRunner;
  private middlewareManager!: MiddlewareManager;
  private readonly initWaves: InitWave[] = [];
  private readonly initializedResourceIds = new Set<string>();
  private readonly readyResourceIds = new Set<string>();
  private hasRunCooldown = false;
  private readonly lifecycleAdmissionController: LifecycleAdmissionController;
  private readonly executionContextStore: ExecutionContextStore;

  #isLocked = false;
  #isInitialized = false;
  public mode: RunnerMode;

  constructor(
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
    public readonly onUnhandledError: OnUnhandledError,
    mode?: RunnerMode,
    lifecycleAdmissionController?: LifecycleAdmissionController,
    executionContextStore?: ExecutionContextStore,
  ) {
    this.lifecycleAdmissionController =
      lifecycleAdmissionController ?? new LifecycleAdmissionController();
    this.executionContextStore =
      executionContextStore ?? new ExecutionContextStore(null);
    this.registry = new StoreRegistry(this);
    this.lookup = new StoreLookup(this.registry);
    this.validator = this.registry.getValidator();
    this.overrideManager = new OverrideManager(this.registry);
    this.middlewareManager = new MiddlewareManager(this);

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
   * Returns the shared execution-context store used by runtime-facing
   * execution entrypoints and framework internals.
   */
  public getExecutionContextStore(): ExecutionContextStore {
    return this.executionContextStore;
  }

  /**
   * Checks whether a registered item is visible to a consumer id under the
   * current exports visibility model.
   */
  public isItemVisibleToConsumer(
    targetId: string,
    consumerId: string,
    channel: IsolationChannel = "dependencies",
  ): boolean {
    return this.registry.visibilityTracker.isAccessible(
      targetId,
      consumerId,
      channel,
    );
  }

  /**
   * Returns the concrete visibility/isolation violation for a target-consumer
   * pair when one exists.
   */
  public getAccessViolation(
    targetId: string,
    consumerId: string,
    channel: IsolationChannel = "dependencies",
  ): AccessViolation | null {
    return this.registry.visibilityTracker.getAccessViolation(
      targetId,
      consumerId,
      channel,
    );
  }

  /**
   * Returns the owner resource id that directly registered the given item.
   */
  public getOwnerResourceId(itemId: string): string | undefined {
    const resolvedItemId =
      this.lookup.resolveCandidateId(itemId) ??
      this.lookup.extractRequestedId(itemId) ??
      itemId;
    return this.registry.visibilityTracker.getOwnerResourceId(resolvedItemId);
  }

  public findIdByDefinition(definition: unknown): string {
    const canonicalId = this.lookup.resolveCandidateId(definition) ?? undefined;
    check(canonicalId, Match.NonEmptyString);
    const resolvedCanonicalId = canonicalId as string;
    if (!this.hasId(resolvedCanonicalId)) {
      runtimeElementNotFoundError.throw({
        type: "Definition",
        elementId:
          typeof definition === "string" ? definition : resolvedCanonicalId,
      });
    }

    return resolvedCanonicalId;
  }

  public findDefinitionById(canonicalId: string): RegisterableItem {
    const definition = this.lookup.tryDefinitionById(canonicalId);
    if (definition === null) {
      runtimeElementNotFoundError.throw({
        type: "Definition",
        elementId: canonicalId,
      });
    }

    return definition as RegisterableItem;
  }

  public hasDefinition(definition: unknown): boolean {
    const canonicalId = this.lookup.resolveCandidateId(definition);
    if (!canonicalId) {
      return false;
    }

    return this.hasId(canonicalId);
  }

  public hasId(canonicalId: string): boolean {
    return this.lookup.tryDefinitionById(canonicalId) !== null;
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

  /**
   * Returns whether the resource explicitly declared an exports boundary.
   */
  public hasExportsDeclaration(resourceId: string): boolean {
    return this.registry.visibilityTracker.hasExportsDeclaration(resourceId);
  }

  get isLocked() {
    return this.#isLocked;
  }

  public isInShutdownLockdown() {
    return this.lifecycleAdmissionController.isShutdownLockdown();
  }

  public isDisposalStarted() {
    const phase = this.lifecycleAdmissionController.getPhase();
    return (
      phase === RuntimeLifecyclePhase.CoolingDown ||
      phase === RuntimeLifecyclePhase.Disposing ||
      phase === RuntimeLifecyclePhase.Drained ||
      phase === RuntimeLifecyclePhase.Disposed
    );
  }

  public canAdmitTaskCall(source: RuntimeCallSource): boolean {
    return this.lifecycleAdmissionController.canAdmitTask(source);
  }

  public beginDisposing() {
    const phase = this.lifecycleAdmissionController.getPhase();
    if (
      phase === RuntimeLifecyclePhase.Disposing ||
      phase === RuntimeLifecyclePhase.Drained ||
      phase === RuntimeLifecyclePhase.Disposed
    ) {
      return;
    }
    this.lifecycleAdmissionController.beginDisposing();
  }

  public beginCoolingDown() {
    const phase = this.lifecycleAdmissionController.getPhase();
    if (
      phase === RuntimeLifecyclePhase.CoolingDown ||
      phase === RuntimeLifecyclePhase.Disposing ||
      phase === RuntimeLifecyclePhase.Drained ||
      phase === RuntimeLifecyclePhase.Disposed
    ) {
      return;
    }
    this.lifecycleAdmissionController.beginCoolingDown();
  }

  public beginDrained() {
    this.lifecycleAdmissionController.beginDrained();
  }

  public async waitForDrain(drainingBudgetMs: number): Promise<boolean> {
    return this.lifecycleAdmissionController.waitForDrain(drainingBudgetMs);
  }

  public cancelDrainWaiters(): void {
    this.lifecycleAdmissionController.cancelDrainWaiters();
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

  private bindFrameworkResourceValues(runtimeResult: RunResult<unknown>) {
    if (!this.taskRunner) {
      taskRunnerNotSetError.throw();
    }

    this.configureExecutionContextResource();
    const eventManagerFacade = this.createEventManagerFacade();

    const builtInResourcesMap = new Map<
      IResource<any, any, any, any, any>,
      unknown
    >();
    builtInResourcesMap.set(globalResources.store, this);
    builtInResourcesMap.set(globalResources.eventManager, eventManagerFacade);
    builtInResourcesMap.set(globalResources.mode, this.mode);
    builtInResourcesMap.set(globalResources.logger, this.logger);
    builtInResourcesMap.set(globalResources.taskRunner, this.taskRunner);
    builtInResourcesMap.set(globalResources.serializer, new Serializer());
    builtInResourcesMap.set(
      globalResources.executionContext,
      this.executionContextStore,
    );
    builtInResourcesMap.set(
      globalResources.middlewareManager,
      this.middlewareManager,
    );
    builtInResourcesMap.set(globalResources.runtime, runtimeResult);

    for (const [resource, value] of builtInResourcesMap.entries()) {
      const entry = this.resources.get(resource.id);
      if (!entry) {
        continue;
      }

      entry.value = value;
      entry.isInitialized = true;
      this.recordResourceInitialized(entry.resource.id);
    }
  }

  private configureExecutionContextResource(): void {
    const entry = this.resources.get(globalResources.executionContext.id);
    if (!entry) {
      this.executionContextStore.configure(null);
      return;
    }

    this.executionContextStore.configure(
      resolveExecutionContextConfig(entry.config),
    );
  }

  public setTaskRunner(taskRunner: TaskRunner) {
    this.taskRunner = taskRunner;
  }

  private createEventManagerFacade(): EventManager {
    const resolveRegisteredEvent = <TInput>(
      eventDefinition: IEvent<TInput>,
    ): IEvent<TInput> => {
      const eventId = this.findIdByDefinition(eventDefinition);
      const storeEvent = this.events.get(eventId);
      if (!storeEvent) {
        runtimeElementNotFoundError.throw({
          type: "Event",
          elementId: eventId,
        });

        return undefined as never;
      }

      return storeEvent.event as IEvent<TInput>;
    };
    const resolveRuntimeSource = (
      source: RuntimeCallSource,
    ): RuntimeCallSource => ({
      ...source,
      id: resolveRequestedIdFromStore(this, source.id) ?? source.id,
    });
    const manager = this.eventManager;

    return {
      enterShutdownLockdown: () => manager.enterShutdownLockdown(),
      lock: () => manager.lock(),
      emit: (<TInput>(
        eventDefinition: IEvent<TInput>,
        data: TInput,
        request: RuntimeCallSource | IEventEmissionCallOptions,
      ) => {
        const options =
          "source" in request
            ? {
                ...request,
                source: resolveRuntimeSource(request.source),
              }
            : { source: resolveRuntimeSource(request) };
        return manager.emit(
          resolveRegisteredEvent(eventDefinition),
          data,
          options,
        );
      }) as EventManager["emit"],
      emitLifecycle: (<TInput>(
        eventDefinition: IEvent<TInput>,
        data: TInput,
        request: RuntimeCallSource | IEventEmissionCallOptions,
      ) => {
        const options =
          "source" in request
            ? {
                ...request,
                source: resolveRuntimeSource(request.source),
              }
            : { source: resolveRuntimeSource(request) };
        return manager.emitLifecycle(
          resolveRegisteredEvent(eventDefinition),
          data,
          options,
        );
      }) as EventManager["emitLifecycle"],
      emitWithResult: (<TInput>(
        eventDefinition: IEvent<TInput>,
        data: TInput,
        request: RuntimeCallSource | IEventEmissionCallOptions,
      ) => {
        const options =
          "source" in request
            ? {
                ...request,
                source: resolveRuntimeSource(request.source),
              }
            : { source: resolveRuntimeSource(request) };
        return manager.emitWithResult(
          resolveRegisteredEvent(eventDefinition),
          data,
          options,
        );
      }) as EventManager["emitWithResult"],
      addListener: (<TInput>(
        event: IEvent<TInput> | Array<IEvent<TInput>>,
        handler: Parameters<EventManager["addListener"]>[1],
        options?: Parameters<EventManager["addListener"]>[2],
      ) =>
        manager.addListener(
          Array.isArray(event)
            ? event.map((entry) => resolveRegisteredEvent(entry))
            : resolveRegisteredEvent(event),
          handler as any,
          options as any,
        )) as EventManager["addListener"],
      addGlobalListener: manager.addGlobalListener.bind(manager),
      removeListenerById: manager.removeListenerById.bind(manager),
      hasListeners: (<TInput>(eventDefinition: IEvent<TInput>) =>
        manager.hasListeners(
          resolveRegisteredEvent(eventDefinition),
        )) as EventManager["hasListeners"],
      intercept: manager.intercept.bind(manager),
      interceptHook: manager.interceptHook.bind(manager),
      executeHookWithInterceptors:
        manager.executeHookWithInterceptors.bind(manager),
      dispose: manager.dispose.bind(manager),
      get isLocked() {
        return manager.isLocked;
      },
    } as EventManager;
  }

  private resolveRootEntry(
    rootDefinition: IResource<any>,
  ): ResourceStoreElementType {
    const rootId =
      this.lookup.resolveCandidateId(rootDefinition) ?? rootDefinition.id;
    const rootEntry = this.resources.get(rootId);

    if (rootEntry) {
      return rootEntry;
    }

    validationError.throw({
      subject: "Root resource",
      id: rootDefinition.id,
      originalError:
        "Root resource was not registered during framework bootstrap. This indicates an inconsistent runtime setup.",
    });

    return undefined as never;
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
    options?: {
      debug?: DebugFriendlyConfig;
      executionContext?: RunResult<unknown>["runOptions"]["executionContext"];
    },
  ) {
    if (this.#isInitialized) {
      storeAlreadyInitializedError.throw();
    }

    const frameworkRoot = createSyntheticFrameworkRoot({
      rootItem: root.with(config as any),
      debug: options?.debug,
      executionContext: options?.executionContext ?? null,
    });

    this.registry.computeRegistrationDeeply(frameworkRoot);
    this.bindFrameworkResourceValues(runtimeResult);
    const rootEntry = this.resolveRootEntry(root);
    this.root = rootEntry;
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
    const disposalErrors: Error[] = [];

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

  private getResourcesInReadyWaves(): DisposeWave[] {
    return computeReadyWaves(this.resources, this.initWaves);
  }

  /** @internal Executes startup-ready hooks for initialized resources. */
  public async ready() {
    for (const wave of this.getResourcesInReadyWaves()) {
      await this.readyWave(wave);
    }
  }

  /** @internal Executes ready for a single initialized resource (used by lazy init). */
  public async readyResource(resourceId: string): Promise<void> {
    const resource = this.resources.get(resourceId);
    if (!resource) {
      return;
    }

    this.assertLazyResourceWakeupAllowed(resourceId);

    await this.runReadyResource(resource);
  }

  public async cooldown(options?: { shouldStop?: () => boolean }) {
    if (this.hasRunCooldown) {
      return;
    }

    this.hasRunCooldown = true;

    for (const wave of this.getResourcesInDisposeWaves()) {
      if (options?.shouldStop?.()) {
        return;
      }

      const waveErrors = await this.cooldownWave(wave, options);
      await this.logCooldownErrors(waveErrors);
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
    this.readyResourceIds.clear();
    this.hasRunCooldown = false;
    this.markDisposed();
  }

  /**
   * Executes a lifecycle wave (cooldown or dispose) on all resources in the wave,
   * honoring the parallel flag. Returns any errors encountered without throwing.
   */
  private async executeWave(
    wave: DisposeWave,
    action: (resource: ResourceStoreElementType) => Promise<void>,
  ): Promise<Error[]> {
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
        wave.resources.map((resource) => action(resource)),
      );
      return collectWaveErrors(results);
    }

    const errors: Error[] = [];
    for (const resource of wave.resources) {
      try {
        await action(resource);
      } catch (error) {
        errors.push(normalizeError(error));
      }
    }
    return errors;
  }

  private async cooldownWave(
    wave: DisposeWave,
    options?: { shouldStop?: () => boolean },
  ): Promise<Error[]> {
    return this.executeWave(wave, async (resource) => {
      if (options?.shouldStop?.()) {
        return;
      }

      await this.cooldownResource(resource);
    });
  }

  private async readyWave(wave: DisposeWave): Promise<void> {
    if (wave.parallel) {
      try {
        await Promise.all(
          wave.resources.map((resource) => this.runReadyResource(resource)),
        );
      } catch (error) {
        throw this.normalizeError(error);
      }
      return;
    }

    for (const resource of wave.resources) {
      try {
        await this.runReadyResource(resource);
      } catch (error) {
        throw this.normalizeError(error);
      }
    }
  }

  private async disposeWave(wave: DisposeWave): Promise<Error[]> {
    return this.executeWave(wave, (r) => this.disposeResource(r));
  }

  private normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private async logCooldownErrors(errors: readonly Error[]): Promise<void> {
    for (const error of errors) {
      try {
        await this.logger.warn(
          "Resource cooldown failed; continuing shutdown.",
          {
            source: "store.cooldown",
            error,
          },
        );
      } catch {
        // Logging must never promote cooldown failures into shutdown failures.
      }
    }
  }

  private async runReadyResource(
    resource: ResourceStoreElementType,
  ): Promise<void> {
    if (!resource.isInitialized || !resource.resource.ready) {
      return;
    }

    const resourceId = resource.resource.id;
    if (this.readyResourceIds.has(resourceId)) {
      return;
    }

    await resource.resource.ready(
      resource.value,
      resource.config,
      resource.computedDependencies ?? {},
      resource.context,
    );
    this.readyResourceIds.add(resourceId);
  }

  public assertLazyResourceWakeupAllowed(resourceId: string): void {
    if (!this.isDisposalStarted()) {
      return;
    }

    lazyResourceShutdownAccessError.throw({
      id: this.findIdByDefinition(resourceId),
    });
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

    const admissionTargets = await resource.resource.cooldown(
      resource.value,
      resource.config,
      resource.computedDependencies ?? {},
      resource.context,
    );

    this.registerCooldownAdmissionTargets(
      this.findIdByDefinition(resource.resource),
      resource.resource,
      admissionTargets,
    );
  }

  private registerCooldownAdmissionTargets(
    resourceRuntimePath: string,
    resource: IResource<any, any, any, any, any>,
    targets: void | ResourceCooldownAdmissionTargets,
  ): void {
    this.lifecycleAdmissionController.allowShutdownResourceSource(
      resourceRuntimePath,
    );

    if (!targets || targets.length === 0) {
      return;
    }

    for (const target of targets) {
      const resolvedRuntimePath = this.resolveCooldownAdmissionTargetPath(
        resource,
        target,
      );
      this.lifecycleAdmissionController.allowShutdownResourceSource(
        resolvedRuntimePath,
      );
    }
  }

  private resolveCooldownAdmissionTargetPath(
    resource: IResource<any, any, any, any, any>,
    target: ResourceCooldownAdmissionTargets[number],
  ): string {
    const resolvedRuntimePath = this.registry.resolveDefinitionId(target);
    if (
      typeof resolvedRuntimePath !== "string" ||
      !this.resources.has(resolvedRuntimePath)
    ) {
      throw resourceCooldownAdmissionTargetInvalidError.new({
        resourceId: this.findIdByDefinition(resource),
        targetId: String(target?.id ?? target),
      });
    }

    return resolvedRuntimePath;
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
  public storeGenericItem<C>(item: RegisterableItem) {
    return this.registry.storeGenericItem<C>(item);
  }

  /**
   * Provides a way to access tagged elements from the store.
   */
  public getTagAccessor<TTag extends ITag<any, any, any>>(
    tag: TTag,
    options?: { consumerId?: string; includeSelf?: boolean },
  ): TagDependencyAccessor<TTag> {
    return this.registry.getTagAccessor(tag, options);
  }
}
