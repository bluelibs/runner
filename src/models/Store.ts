import {
  IResource,
  RegisterableItems,
  ITag,
  TagDependencyAccessor,
} from "../defs";
import { findCircularDependencies } from "./utils/findCircularDependencies";
import {
  circularDependencyError,
  resourceCooldownAdmissionTargetInvalidError,
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
import {
  getResourcesInDisposeWaves as computeDisposeWaves,
  getResourcesInReadyWaves as computeReadyWaves,
} from "./utils/disposeOrder";
import { RunResult } from "./RunResult";
import type { RuntimeCallSource } from "../types/runtimeSource";
import { runtimeSource } from "../types/runtimeSource";
import {
  LifecycleAdmissionController,
  RuntimeLifecyclePhase,
} from "./runtime/LifecycleAdmissionController";
import { createFrameworkRootGateway } from "./createFrameworkRootGateway";
import type { DebugFriendlyConfig } from "../globals/resources/debug";
import { symbolRuntimeId } from "../types/symbols";
import { getRuntimeId } from "../tools/runtimeMetadata";
import type { ResourceCooldownAdmissionTargets } from "../types/resource";

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
  private readonly readyResourceIds = new Set<string>();
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
    this.middlewareManager = new MiddlewareManager(this);
    this.eventManager.bindStore(this);

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
    const resolvedItemId = this.resolveDefinitionId(itemId) ?? itemId;
    return this.registry.visibilityTracker.getOwnerResourceId(resolvedItemId);
  }

  public resolveDefinitionId(reference: unknown): string | undefined {
    return this.registry.resolveDefinitionId(reference);
  }

  public toPublicId(reference: unknown): string {
    return this.getRuntimeMetadata(reference).id;
  }

  public toPublicPath(reference: unknown): string {
    return this.getRuntimeMetadata(reference).path;
  }

  public getRuntimeDefinitionId(reference: unknown): string {
    const runtimeId =
      getRuntimeId(reference) ?? this.resolveDefinitionId(reference);
    this.assertResolvedDefinitionId(runtimeId, reference);
    return runtimeId;
  }

  public getRuntimeMetadata(reference: unknown): {
    id: string;
    path: string;
    runtimeId: string;
  } {
    const runtimeId = this.getRuntimeDefinitionId(reference);
    return {
      id: this.registry.getDisplayId(runtimeId),
      path: runtimeId,
      runtimeId,
    };
  }

  public toRuntimeSource(source: RuntimeCallSource): RuntimeCallSource {
    const runtimeId = this.getRuntimeDefinitionId(source);
    return {
      ...source,
      id: this.registry.getDisplayId(runtimeId),
      path: runtimeId,
    };
  }

  public createRuntimeSource(
    kind: RuntimeCallSource["kind"],
    reference: unknown,
  ): RuntimeCallSource {
    const metadata = this.getRuntimeMetadata(reference);
    switch (kind) {
      case "task":
        return runtimeSource.task(metadata.id, metadata.path);
      case "hook":
        return runtimeSource.hook(metadata.id, metadata.path);
      case "resource":
        return runtimeSource.resource(metadata.id, metadata.path);
      case "middleware":
        return runtimeSource.middleware(metadata.id, metadata.path);
      default:
        return runtimeSource.runtime(metadata.id, metadata.path);
    }
  }

  private assertResolvedDefinitionId(
    resolvedId: string | undefined,
    reference: unknown,
  ): asserts resolvedId is string {
    if (typeof resolvedId !== "string" || resolvedId.length === 0) {
      validationError.throw({
        subject: "Definition reference",
        id: String(reference),
        originalError:
          "Unable to resolve a definition id from the provided reference.",
      });
    }
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

  private bindFrameworkResourceValues(runtimeResult: RunResult<unknown>) {
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
      const entry = this.resources.get(resource.id);
      if (!entry) {
        continue;
      }

      entry.value = value;
      entry.isInitialized = true;
      this.recordResourceInitialized(resource.id);
    }
  }

  public setTaskRunner(taskRunner: TaskRunner) {
    this.taskRunner = taskRunner;
  }

  private resolveRootEntry(
    rootDefinition: IResource<any>,
  ): ResourceStoreElementType {
    const rootId =
      this.registry.resolveDefinitionId(rootDefinition) ?? rootDefinition.id;
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
    },
  ) {
    if (this.#isInitialized) {
      storeAlreadyInitializedError.throw();
    }

    const frameworkRoot = createFrameworkRootGateway({
      rootItem: root.with(config as any),
      debug: options?.debug,
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

    await this.runReadyResource(resource);
  }

  public async cooldown() {
    if (this.hasRunCooldown) {
      return;
    }

    this.hasRunCooldown = true;

    for (const wave of this.getResourcesInDisposeWaves()) {
      const waveErrors = await this.cooldownWave(wave);
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

  private async cooldownWave(wave: DisposeWave): Promise<Error[]> {
    return this.executeWave(wave, (r) => this.cooldownResource(r));
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
      this.getRuntimeDefinitionId(resource.resource),
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
    const resolvedRuntimePath = this.resolveDefinitionId(target);
    if (
      typeof resolvedRuntimePath !== "string" ||
      !this.resources.has(resolvedRuntimePath)
    ) {
      throw resourceCooldownAdmissionTargetInvalidError.new({
        resourceId: this.toPublicId(resource),
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
  public storeGenericItem<C>(item: RegisterableItems) {
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

  public toPublicDefinition<TDefinition extends { id: string }>(
    definition: TDefinition,
  ): TDefinition {
    const metadata = this.getRuntimeMetadata(definition);
    return {
      ...definition,
      id: metadata.id,
      path: metadata.path,
      [symbolRuntimeId]: metadata.runtimeId,
    };
  }
}
