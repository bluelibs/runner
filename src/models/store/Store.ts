import {
  IResource,
  IsolationChannel,
  ITag,
  RegisterableItem,
  TagDependencyAccessor,
} from "../../defs";
import { findCircularDependencies } from "../utils/findCircularDependencies";
import {
  circularDependencyError,
  eventEmissionCycleError,
  lockedError,
  runtimeElementNotFoundError,
} from "../../errors";
import { EventManager } from "../EventManager";
import { Logger } from "../Logger";
import { StoreRegistry } from "./StoreRegistry";
import { OverrideManager, type OverrideInspection } from "../OverrideManager";
import { StoreValidator } from "./StoreValidator";
import {
  DisposeWave,
  EventStoreElementType,
  InitWave,
  ResourceStoreElementType,
  TaskStoreElementType,
} from "../../types/storeTypes";
import type { IRuntimeInspectionLifecycle } from "../../types/runtimeInspection";
import { TaskRunner } from "../TaskRunner";
import { OnUnhandledError } from "../UnhandledError";
import { MiddlewareManager } from "../MiddlewareManager";
import { RunnerMode } from "../../types/runner";
import { detectRunnerMode } from "../../tools/detectRunnerMode";
import { RunResult } from "../RunResult";
import { LifecycleAdmissionController } from "../runtime/LifecycleAdmissionController";
import type { DebugFriendlyConfig } from "../../globals/resources/debug";
import { Match, check } from "../../tools/check/engine";
import { StoreLookup } from "./StoreLookup";
import { ExecutionContextStore } from "../ExecutionContextStore";
import type { AccessViolation } from "../VisibilityTracker";
import type { IdentityAsyncContext } from "../../types/runner";
import { HealthReporter } from "../HealthReporter";
import { StoreBootstrapCoordinator } from "./StoreBootstrapCoordinator";
import { StoreLifecycleCoordinator } from "./StoreLifecycleCoordinator";

export type {
  DisposeWave,
  EventStoreElementType,
  InitWave,
  ResourceStoreElementType,
  TaskStoreElementType,
};

/**
 * Central runtime registry, visibility facade, and coordinator hub for a single `run(app)` instance.
 */
export class Store {
  root!: ResourceStoreElementType;
  private registry: StoreRegistry;
  public readonly lookup: StoreLookup;
  private overrideManager: OverrideManager;
  private validator: StoreValidator;
  private taskRunner?: TaskRunner;
  private middlewareManager: MiddlewareManager;
  public readonly admission: LifecycleAdmissionController;
  private readonly executionContextStore: ExecutionContextStore;
  private readonly healthReporter: HealthReporter;
  public readonly bootstrap: StoreBootstrapCoordinator;
  public readonly lifecycle: StoreLifecycleCoordinator;

  #isLocked = false;
  public mode: RunnerMode;

  constructor(
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
    public readonly onUnhandledError: OnUnhandledError,
    mode?: RunnerMode,
    lifecycleAdmissionController?: LifecycleAdmissionController,
    executionContextStore?: ExecutionContextStore,
  ) {
    this.mode = detectRunnerMode(mode);
    this.admission =
      lifecycleAdmissionController ?? new LifecycleAdmissionController();
    this.executionContextStore =
      executionContextStore ?? new ExecutionContextStore(null);
    this.registry = new StoreRegistry(this);
    this.lookup = new StoreLookup(this.registry);
    this.validator = this.registry.getValidator();
    this.overrideManager = new OverrideManager(this.registry);
    this.middlewareManager = new MiddlewareManager(this);
    this.healthReporter = new HealthReporter(this);
    this.lifecycle = new StoreLifecycleCoordinator({
      eventManager: this.eventManager,
      admission: this.admission,
      logger: this.logger,
      resources: this.resources,
      findIdByDefinition: (definition) => this.findIdByDefinition(definition),
      resolveDefinitionId: (reference) =>
        this.registry.resolveDefinitionId(reference),
    });
    this.bootstrap = new StoreBootstrapCoordinator({
      eventManager: this.eventManager,
      executionContextStore: this.executionContextStore,
      logger: this.logger,
      middlewareManager: this.middlewareManager,
      mode: this.mode,
      overrideManager: this.overrideManager,
      registry: this.registry,
      resources: this.resources,
      lookup: this.lookup,
      validator: this.validator,
      lifecycle: this.lifecycle,
      getTaskRunner: () => this.taskRunner,
      resolveStoreResource: () => this,
      resolveRegisteredDefinition: (definition) =>
        this.resolveRegisteredDefinition(definition),
    });
  }

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
  get isLocked() {
    return this.#isLocked;
  }

  public getMiddlewareManager(): MiddlewareManager {
    return this.middlewareManager;
  }

  public getLifecycleAdmissionController(): LifecycleAdmissionController {
    return this.admission;
  }

  public getExecutionContextStore(): ExecutionContextStore {
    return this.executionContextStore;
  }

  public getHealthReporter(): HealthReporter {
    return this.healthReporter;
  }

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

  public getOwnerResourceId(itemId: string): string | undefined {
    const resolvedItemId =
      this.lookup.resolveCandidateId(itemId) ??
      this.lookup.extractRequestedId(itemId) ??
      itemId;
    return this.registry.visibilityTracker.getOwnerResourceId(resolvedItemId);
  }

  /**
   * Returns a detached list of source ids recorded for a canonical definition.
   * @internal
   */
  public getDefinitionSourceIds(canonicalId: string): readonly string[] {
    return this.registry.getDefinitionSourceIds(canonicalId);
  }

  /** Returns detached winner metadata when a canonical target was overridden. @internal */
  public getOverrideInspection(
    canonicalId: string,
  ): OverrideInspection | undefined {
    return this.overrideManager.getOverrideInspection(canonicalId);
  }

  /** Returns detached resource lifecycle waves retained by this runtime. @internal */
  public getLifecycleInspection(): IRuntimeInspectionLifecycle {
    return this.lifecycle.getLifecycleInspection();
  }

  public resolveHookTargets(
    hook: Parameters<StoreRegistry["resolveHookTargets"]>[0],
  ) {
    return this.registry.resolveHookTargets(hook);
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

  public resolveRegisteredDefinition<TDefinition extends RegisterableItem>(
    definition: TDefinition,
  ): TDefinition {
    const canonicalId = this.findIdByDefinition(definition);
    const resolvedDefinition = this.lookup.tryDefinitionById(canonicalId);
    if (resolvedDefinition === null) {
      runtimeElementNotFoundError.throw({
        type: "Definition",
        elementId: canonicalId,
      });
      return undefined as never;
    }

    return resolvedDefinition as TDefinition;
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

  public isItemWithinResourceSubtree(
    resourceId: string,
    itemId: string,
  ): boolean {
    return this.registry.visibilityTracker.isWithinResourceSubtree(
      resourceId,
      itemId,
    );
  }

  public getRootAccessInfo(
    targetId: string,
    rootId: string,
  ): { accessible: boolean; exportedIds: string[] } {
    return this.registry.visibilityTracker.getRootAccessInfo(targetId, rootId);
  }

  public hasExportsDeclaration(resourceId: string): boolean {
    return this.registry.visibilityTracker.hasExportsDeclaration(resourceId);
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

  public setTaskRunner(taskRunner: TaskRunner) {
    this.taskRunner = taskRunner;
  }

  public validateDependencyGraph() {
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
      identity?: IdentityAsyncContext | null;
    },
  ) {
    this.root = this.bootstrap.initializeStore(
      root,
      config,
      runtimeResult,
      options,
    );
  }

  public async dispose() {
    await this.lifecycle.dispose();
  }

  public recordResourceInitialized(resourceId: string) {
    this.lifecycle.recordResourceInitialized(resourceId);
  }

  public recordInitWave(resourceIds: readonly string[]) {
    this.lifecycle.recordInitWave(resourceIds);
  }

  public async ready(options?: { shouldStop?: () => void }) {
    await this.lifecycle.ready(options);
  }

  public async readyResource(resourceId: string): Promise<void> {
    await this.lifecycle.readyResource(resourceId);
  }

  public async cooldown(options?: { shouldStop?: () => boolean }) {
    await this.lifecycle.cooldown(options);
  }

  public assertLazyResourceWakeupAllowed(resourceId: string): void {
    this.lifecycle.assertLazyResourceWakeupAllowed(resourceId);
  }

  public processOverrides() {
    this.overrideManager.processOverrides();
    this.registry.clearHookTargetResolutionCache();
    this.validator.runSanityChecks();
  }

  public storeGenericItem<C>(item: RegisterableItem) {
    return this.registry.storeGenericItem<C>(item);
  }

  public getTagAccessor<TTag extends ITag<any, any, any, any>>(
    tag: TTag,
    options?: { consumerId?: string; includeSelf?: boolean },
  ): TagDependencyAccessor<TTag> {
    return this.registry.getTagAccessor(tag, options);
  }
}
