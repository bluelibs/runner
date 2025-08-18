import {
  DependencyMapType,
  IResource,
  ResourceDependencyValuesType,
} from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { Logger } from "./Logger";
import { ValidationError } from "../errors";
import { MiddlewareManager } from "./MiddlewareManager";

export class ResourceInitializer {
  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
  ) {
    this.middlewareManager = new MiddlewareManager(
      this.store,
      this.eventManager,
      this.logger,
    );
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
  ): Promise<{ value: TValue; context: TContext }> {
    const context = resource.context?.();

    let value: TValue | undefined;
    // Create a no-op init function if it doesn't exist
    if (!resource.init) {
      resource.init = (async () => undefined) as any;
    }

    if (resource.init) {
      value = await this.initWithMiddleware(
        resource,
        config,
        dependencies,
        context,
      );
    }

    return { value: value as TValue, context };
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
