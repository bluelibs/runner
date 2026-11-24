import {
  DependencyMapType,
  IResource,
  ResourceDependencyValuesType,
} from "../defs";
import type { ResourceStoreElementType } from "../types/storeTypes";
import { EventManager } from "./EventManager";
import { Store } from "./store/Store";
import { Logger } from "./Logger";
import type { MiddlewareManager } from "./MiddlewareManager";
import type { DependencyExtractor } from "./dependency-processor/DependencyExtractor";

export class ResourceInitializer {
  private readonly middlewareManager: MiddlewareManager;
  private readonly inFlightResourceInitializations = new Map<
    string,
    Promise<void>
  >();

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
    private readonly getDependencyExtractor?: () => DependencyExtractor,
  ) {
    this.middlewareManager = this.store.getMiddlewareManager();
  }

  /**
   * Initializes a registered resource with single-flight deduplication and rollback on post-init failure.
   */
  public async ensureResourceInitialized(
    resource: ResourceStoreElementType<any, any, any>,
    options?: { trackInitCompletion?: boolean },
  ): Promise<void> {
    if (resource.isInitialized) {
      return;
    }

    const resourceId = resource.resource.id;
    this.store.assertLazyResourceWakeupAllowed(resourceId);
    const existingInitialization =
      this.inFlightResourceInitializations.get(resourceId);
    if (existingInitialization) {
      await existingInitialization;
      return;
    }

    const initialization = (async () => {
      try {
        await this.processResourceDependencies(resource);
        const { value, context } = await this.initializeResource(
          resource.resource,
          resource.config,
          resource.computedDependencies!,
        );
        resource.context = context;
        resource.value = value;
        resource.isInitialized = true;
        if (options?.trackInitCompletion !== false) {
          this.store.recordResourceInitialized(resourceId);
        }
        if (this.store.isLocked) {
          this.store.assertLazyResourceWakeupAllowed(resourceId);
          await this.store.readyResource(resourceId);
        }
      } catch (error: unknown) {
        // If init itself failed, isInitialized was never committed and there is
        // nothing to dispose. But when the failure happens after init (a lazy
        // wakeup rejected at shutdown admission, or a throwing ready()), the value
        // is live: dispose it here, because resetting isInitialized below would
        // make the regular dispose path skip it and leak whatever it owns.
        if (resource.isInitialized && resource.resource.dispose) {
          try {
            await resource.resource.dispose(
              resource.value,
              resource.config,
              resource.computedDependencies!,
              resource.context,
            );
          } catch {
            // Best-effort cleanup; preserve the original init/ready error.
          }
        }
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

  /**
   * Computes and caches dependencies for a resource (if not already computed).
   */
  public async processResourceDependencies<TD extends DependencyMapType>(
    resource: ResourceStoreElementType<any, any, TD>,
  ): Promise<void> {
    if (resource.computedDependencies !== undefined) {
      return;
    }

    const deps = (resource.resource.dependencies || ({} as TD)) as TD;
    const extractor = this.getDependencyExtractor!();
    const extracted = await extractor.extractDependencies(
      deps,
      resource.resource.id,
    );

    resource.computedDependencies = extractor.wrapResourceDependencies<TD>(
      deps,
      extracted,
      resource.resource.id,
    );
  }

  /**
   * Begins the execution of a task. These are registered tasks and all sanity checks have been performed at this stage to ensure consistency of the object.
   * This function can throw only if any of the event listeners or run function throws
   */
  public async initializeResource<
    TConfig = null,
    TValue extends Promise<any> = Promise<any>,
    TDeps extends DependencyMapType = {},
    TContext = any,
  >(
    resource: IResource<TConfig, TValue, TDeps>,
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDeps>,
  ): Promise<{ value: TValue | undefined; context: TContext }> {
    const context = resource.context ? resource.context() : ({} as TContext);

    const value = await this.initWithMiddleware(
      resource,
      config,
      dependencies,
      context,
    );

    return { value, context };
  }

  // Lifecycle emissions removed

  public async initWithMiddleware<
    C,
    V extends Promise<any>,
    D extends DependencyMapType,
    TContext,
  >(
    resource: IResource<C, V, D, TContext>,
    config: C,
    dependencies: ResourceDependencyValuesType<D>,
    context: TContext,
  ) {
    return this.middlewareManager.runResourceInit(
      resource,
      config,
      dependencies,
      context,
    );
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
    const canonicalResourceId = this.store.findIdByDefinition(resourceId);
    const prefix = `Resource "${canonicalResourceId}" initialization failed`;
    if (error instanceof Error) {
      if (!error.message.includes(canonicalResourceId)) {
        error.message = `${prefix}: ${error.message}`;
      }
      if (!Object.prototype.hasOwnProperty.call(error, "resourceId")) {
        Object.defineProperty(error, "resourceId", {
          value: canonicalResourceId,
          configurable: true,
        });
      }
      if (!Object.prototype.hasOwnProperty.call(error, "cause")) {
        Object.defineProperty(error, "cause", {
          value: { resourceId: canonicalResourceId },
          configurable: true,
        });
      }
      throw error;
    }

    const wrapper = new Error(`${prefix}: ${String(error)}`);
    Object.defineProperty(wrapper, "resourceId", {
      value: canonicalResourceId,
      configurable: true,
    });
    Object.defineProperty(wrapper, "cause", {
      value: error,
      configurable: true,
    });
    throw wrapper;
  }
}
