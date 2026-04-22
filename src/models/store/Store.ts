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
import { OverrideManager } from "../OverrideManager";
import { StoreValidator } from "./StoreValidator";
import {
  DisposeWave,
  EventStoreElementType,
  InitWave,
  ResourceStoreElementType,
  TaskStoreElementType,
} from "../../types/storeTypes";
import type { RuntimeCallSource } from "../../types/runtimeSource";
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
 * Store class which is used to store all the resources, tasks, middleware and events.
 */
export class Store {
  root!: ResourceStoreElementType;
  private registry: StoreRegistry;
  public readonly lookup: StoreLookup;
  private overrideManager: OverrideManager;
  private validator: StoreValidator;
  private taskRunner?: TaskRunner;
  private middlewareManager: MiddlewareManager;
  private readonly initWaves: InitWave[] = [];
  private readonly initializedResourceIds = new Set<string>();
  private readonly readyResourceIds = new Set<string>();
  private hasRunCooldown = false;
  private readonly lifecycleAdmissionController: LifecycleAdmissionController;
  private readonly executionContextStore: ExecutionContextStore;
  private readonly healthReporter: HealthReporter;
  private readonly bootstrapCoordinator: StoreBootstrapCoordinator;
  private readonly lifecycleCoordinator: StoreLifecycleCoordinator;

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
    this.mode = detectRunnerMode(mode);
    this.lifecycleAdmissionController =
      lifecycleAdmissionController ?? new LifecycleAdmissionController();
    this.executionContextStore =
      executionContextStore ?? new ExecutionContextStore(null);
    this.registry = new StoreRegistry(this);
    this.lookup = new StoreLookup(this.registry);
    this.validator = this.registry.getValidator();
    this.overrideManager = new OverrideManager(this.registry);
    this.middlewareManager = new MiddlewareManager(this);
    this.healthReporter = new HealthReporter(this);
    this.bootstrapCoordinator = new StoreBootstrapCoordinator({
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
      getTaskRunner: () => this.taskRunner,
      isInitialized: () => this.#isInitialized,
      markInitialized: () => {
        this.#isInitialized = true;
      },
      recordResourceInitialized: (resourceId) =>
        this.recordResourceInitialized(resourceId),
      resolveStoreResource: () => this,
      resolveRegisteredDefinition: (definition) =>
        this.resolveRegisteredDefinition(definition),
    });
    this.lifecycleCoordinator = new StoreLifecycleCoordinator({
      eventManager: this.eventManager,
      initWaves: this.initWaves,
      initializedResourceIds: this.initializedResourceIds,
      lifecycleAdmissionController: this.lifecycleAdmissionController,
      logger: this.logger,
      readyResourceIds: this.readyResourceIds,
      resources: this.resources,
      getHasRunCooldown: () => this.hasRunCooldown,
      setHasRunCooldown: (value) => {
        this.hasRunCooldown = value;
      },
      findIdByDefinition: (definition) => this.findIdByDefinition(definition),
      resolveDefinitionId: (reference) =>
        this.registry.resolveDefinitionId(reference),
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
    return this.lifecycleAdmissionController;
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

  public isInShutdownLockdown() {
    return this.lifecycleCoordinator.isInShutdownLockdown();
  }

  public isDisposalStarted() {
    return this.lifecycleCoordinator.isDisposalStarted();
  }

  public canAdmitTaskCall(source: RuntimeCallSource): boolean {
    return this.lifecycleCoordinator.canAdmitTaskCall(source);
  }

  public beginDisposing() {
    this.lifecycleCoordinator.beginDisposing();
  }

  public beginCoolingDown() {
    this.lifecycleCoordinator.beginCoolingDown();
  }

  public beginAborting() {
    this.lifecycleCoordinator.beginAborting();
  }

  public beginDrained() {
    this.lifecycleCoordinator.beginDrained();
  }

  public async waitForDrain(drainingBudgetMs: number): Promise<boolean> {
    return this.lifecycleCoordinator.waitForDrain(drainingBudgetMs);
  }

  public trackTaskAbortController(controller: AbortController): () => void {
    return this.lifecycleCoordinator.trackTaskAbortController(controller);
  }

  public abortInFlightTaskSignals(reason: string): void {
    this.lifecycleCoordinator.abortInFlightTaskSignals(reason);
  }

  public cancelDrainWaiters(): void {
    this.lifecycleCoordinator.cancelDrainWaiters();
  }

  public markDisposed() {
    this.lifecycleCoordinator.markDisposed();
  }

  public enterShutdownLockdown() {
    this.lifecycleCoordinator.enterShutdownLockdown();
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

  protected createEventManagerFacade(): EventManager {
    return this.bootstrapCoordinator.createEventManagerFacade();
  }

  protected resolveRootEntry(
    rootDefinition: IResource<any>,
  ): ResourceStoreElementType {
    return this.bootstrapCoordinator.resolveRootEntry(rootDefinition);
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
    this.root = this.bootstrapCoordinator.initializeStore(
      root,
      config,
      runtimeResult,
      options,
    );
  }

  public async dispose() {
    await this.lifecycleCoordinator.dispose();
  }

  public recordResourceInitialized(resourceId: string) {
    this.lifecycleCoordinator.recordResourceInitialized(resourceId);
  }

  public recordInitWave(resourceIds: readonly string[]) {
    this.lifecycleCoordinator.recordInitWave(resourceIds);
  }

  public async ready(options?: { shouldStop?: () => void }) {
    await this.lifecycleCoordinator.ready(options);
  }

  public async readyResource(resourceId: string): Promise<void> {
    await this.lifecycleCoordinator.readyResource(resourceId);
  }

  public async cooldown(options?: { shouldStop?: () => boolean }) {
    await this.lifecycleCoordinator.cooldown(options);
  }

  protected async cooldownWave(
    wave: DisposeWave,
    options?: { shouldStop?: () => boolean },
  ): Promise<Error[]> {
    return this.lifecycleCoordinator.cooldownWave(wave, options);
  }

  protected async readyWave(
    wave: DisposeWave,
    options?: { shouldStop?: () => void },
  ): Promise<void> {
    await this.lifecycleCoordinator.readyWave(wave, options);
  }

  public assertLazyResourceWakeupAllowed(resourceId: string): void {
    this.lifecycleCoordinator.assertLazyResourceWakeupAllowed(resourceId);
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
