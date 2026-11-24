import { DependencyMapType } from "../defs";
import { Store } from "./store/Store";
import { HookDependencyState } from "../types/storeTypes";
import { EventManager } from "./EventManager";
import { ResourceInitializer } from "./ResourceInitializer";
import { TaskRunner } from "./TaskRunner";
import { Logger } from "./Logger";
import { ResourceLifecycleMode } from "../types/runner";
import { DependencyExtractor } from "./dependency-processor/DependencyExtractor";
import { HookEventBuffer } from "./dependency-processor/HookEventBuffer";
import { ResourceScheduler } from "./dependency-processor/ResourceScheduler";
import { ExecutionContextStore } from "./ExecutionContextStore";

/**
 * Coordinates bootstrap dependency resolution across middleware, hooks, resources, and tasks.
 */
export class DependencyProcessor {
  public readonly resourceInitializer: ResourceInitializer;
  public readonly dependencyExtractor: DependencyExtractor;
  public readonly hookEventBuffer: HookEventBuffer;
  public readonly resourceScheduler: ResourceScheduler;
  protected readonly logger!: Logger;
  protected readonly lifecycleMode: ResourceLifecycleMode;
  protected readonly lazy: boolean;

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly taskRunner: TaskRunner,
    logger: Logger,
    lifecycleMode: ResourceLifecycleMode = ResourceLifecycleMode.Sequential,
    lazy = false,
    executionContextStore: ExecutionContextStore = new ExecutionContextStore(
      null,
    ),
  ) {
    this.logger = logger.with({ source: "dependencyProcessor" });
    this.lifecycleMode = lifecycleMode;
    this.lazy = lazy;
    this.resourceInitializer = new ResourceInitializer(
      store,
      eventManager,
      logger,
      () => this.dependencyExtractor,
    );
    this.hookEventBuffer = new HookEventBuffer(
      eventManager,
      executionContextStore,
    );
    this.dependencyExtractor = new DependencyExtractor(
      store,
      eventManager,
      taskRunner,
      this.logger,
      (resource) =>
        this.resourceInitializer.ensureResourceInitialized(resource),
    );
    this.resourceScheduler = new ResourceScheduler(store, (resource, options) =>
      this.resourceInitializer.ensureResourceInitialized(resource, options),
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

    if (this.lifecycleMode === ResourceLifecycleMode.Parallel && this.lazy) {
      await this.initializeStartupRequiredResourcesParallel();
    } else if (
      !this.lazy &&
      this.lifecycleMode === ResourceLifecycleMode.Parallel
    ) {
      await this.resourceScheduler.initializeUninitializedResourcesParallel();
    } else if (!this.lazy) {
      for (const resource of this.store.resources.values()) {
        await this.resourceInitializer.processResourceDependencies(resource);
      }
      // leftovers that were registered but not depended upon, except root
      // they should still be initialized as they might extend other
      await this.initializeUninitializedResources();
    }

    for (const task of this.store.tasks.values()) {
      await this.dependencyExtractor.ensureTaskPrepared(task);
    }

    await this.resourceInitializer.processResourceDependencies(this.store.root);
  }

  private async initializeStartupRequiredResourcesParallel() {
    const requiredResourceIds =
      this.resourceScheduler.collectStartupRequiredResourceIds();
    if (requiredResourceIds.size === 0) {
      return;
    }

    await this.resourceScheduler.initializeUninitializedResourcesParallel(
      requiredResourceIds,
    );
  }

  // Initialize non-root resources that are registered but not depended upon (side effects/disposers).
  public async initializeUninitializedResources() {
    for (const resource of this.store.resources.values()) {
      if (
        resource.isInitialized === false &&
        // The root is the last one to be initialized and is done in a separate process.
        resource.resource.id !== this.store.root.resource.id
      ) {
        await this.resourceInitializer.ensureResourceInitialized(resource);
      }
    }
  }

  private async computeResourceMiddlewareDependencies() {
    await Promise.all(
      Array.from(this.store.resourceMiddlewares.values()).map(
        async (middleware) => {
          const computedDependencies =
            await this.dependencyExtractor.extractDependencies(
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
          const computedDependencies =
            await this.dependencyExtractor.extractDependencies(
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
        try {
          hookStoreElement.dependencyState = HookDependencyState.Computing;
          hookStoreElement.computedDependencies =
            await this.dependencyExtractor.extractDependencies(deps, hook.id);
          hookStoreElement.dependencyState = HookDependencyState.Ready;
          await this.hookEventBuffer.flush(hookStoreElement);
        } catch (e) {
          hookStoreElement.dependencyState = HookDependencyState.Error;
          throw e;
        }
      }),
    );
  }

  public async initializeRoot() {
    await this.resourceInitializer.ensureResourceInitialized(this.store.root);
  }

  /**
   * Attaches listeners for all hooks. Must run before emitting events.
   */
  public attachListeners() {
    this.hookEventBuffer.attachListeners(this.store);
  }
}
