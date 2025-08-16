import {
  DependencyMapType,
  DependencyValuesType,
  IResource,
  ResourceDependencyValuesType,
} from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { MiddlewareStoreElementType } from "./StoreTypes";
import { Logger } from "./Logger";
import { globalEvents } from "../globals/globalEvents";

export class ResourceInitializer {
  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger
  ) {}

  /**
   * Begins the execution of an task. These are registered tasks and all sanity checks have been performed at this stage to ensure consistency of the object.
   * This function can throw only if any of the event listeners or run function throws
   */
  public async initializeResource<
    TConfig = null,
    TValue extends Promise<any> = Promise<any>,
    TDeps extends DependencyMapType = {},
    TContext = any
  >(
    resource: IResource<TConfig, TValue, TDeps>,
    config: TConfig,
    dependencies: ResourceDependencyValuesType<TDeps>
  ): Promise<{ value: TValue; context: TContext }> {
    const context = resource.context?.();

    let value: TValue | undefined;
    try {
      if (resource.init) {
        value = await this.initWithMiddleware(
          resource,
          config,
          dependencies,
          context
        );
      }

      return { value: value as TValue, context };
    } catch (error) {
      // Emit central error boundary; still rethrow to caller
      try {
        await this.eventManager.emit(
          globalEvents.unhandledError,
          { kind: "resourceInit", id: resource.id as any, error },
          resource.id as any
        );
      } catch (_) {}
      throw error;
    }
  }

  // Lifecycle emissions removed

  public async initWithMiddleware<
    C,
    V extends Promise<any>,
    D extends DependencyMapType,
    TContext
  >(
    resource: IResource<C, V, D, TContext>,
    config: C,
    dependencies: ResourceDependencyValuesType<D>,
    context: TContext
  ) {
    let next = async (config: C): Promise<V | undefined> => {
      if (resource.init) {
        return resource.init.call(null, config, dependencies, context);
      }
    };

    const existingMiddlewares = resource.middleware;
    const existingMiddlewareIds = existingMiddlewares.map((x) => x.id);
    // Same logic as with tasks, the local middleware has priority over the global middleware, as they might have different configs.
    const globalMiddlewares = this.store
      .getEverywhereMiddlewareForResources(resource)
      .filter((x) => !existingMiddlewareIds.includes(x.id));

    const createdMiddlewares = [...globalMiddlewares, ...existingMiddlewares];

    for (let i = createdMiddlewares.length - 1; i >= 0; i--) {
      const middleware = createdMiddlewares[i];
      const storeMiddleware = this.store.middlewares.get(
        middleware.id
      ) as MiddlewareStoreElementType; // we know it exists because at this stage all sanity checks have been done.

      const nextFunction = next;
      next = async (config: C) => {
        return storeMiddleware.middleware.run(
          {
            resource: {
              definition: resource,
              config,
            },
            next: nextFunction,
          },
          storeMiddleware.computedDependencies,
          middleware.config
        );
      };
    }

    return next(config);
  }
}
