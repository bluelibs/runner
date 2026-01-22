import {
  DependencyMapType,
  IResource,
  ResourceDependencyValuesType,
} from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { Logger } from "./Logger";
import type { MiddlewareManager } from "./MiddlewareManager";

export class ResourceInitializer {
  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
  ) {
    this.middlewareManager = this.store.getMiddlewareManager();
  }

  private readonly middlewareManager: MiddlewareManager;

  /**
   * Begins the execution of an task. These are registered tasks and all sanity checks have been performed at this stage to ensure consistency of the object.
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
    const context = resource.context?.() as TContext;

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
}
