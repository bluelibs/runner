import {
  DependencyMapType,
  DependencyValuesType,
  ITask,
  IResource,
} from "../defs";
import { EventManager } from "./EventManager";
import { globalEvents } from "../globals/globalEvents";
import { Store } from "./Store";
import { MiddlewareStoreElementType } from "./StoreTypes";
import { Logger } from "./Logger";

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
    dependencies: DependencyValuesType<TDeps>
  ): Promise<{ value: TValue; context: TContext }> {
    const context = resource.context?.();
    await this.eventManager.emit(
      globalEvents.resources.beforeInit,
      {
        config,
        resource,
      },
      resource.id
    );

    await this.eventManager.emit(
      resource.events.beforeInit,
      { config },
      resource.id
    );

    let error: any, value: TValue | undefined;
    try {
      if (resource.init) {
        value = await this.initWithMiddleware(
          resource,
          config,
          dependencies,
          context
        );
      }

      await this.eventManager.emit(
        resource.events.afterInit,
        {
          config,
          value: value as TValue,
        },
        resource.id
      );
      await this.eventManager.emit(
        globalEvents.resources.afterInit,
        {
          config,
          resource,
          value: value as TValue,
        },
        resource.id
      );

      this.logger.debug(`Resource ${resource.id.toString()} initialized`, {
        source: resource.id,
      });

      return { value: value as TValue, context };
    } catch (e) {
      error = e;
      let isSuppressed = false;
      function suppress() {
        isSuppressed = true;
      }

      // If you want to rewthrow the error, this should be done inside the onError event.
      await this.eventManager.emit(
        resource.events.onError,
        {
          error: error as Error,
          suppress,
        },
        resource.id
      );
      await this.eventManager.emit(
        globalEvents.resources.onError,
        {
          error: error as Error,
          resource,
          suppress,
        },
        resource.id
      );

      if (!isSuppressed) throw e;

      return { value: undefined as unknown as TValue, context: {} as TContext };
    }
  }

  public async initWithMiddleware<
    C,
    V extends Promise<any>,
    D extends DependencyMapType,
    TContext
  >(
    resource: IResource<C, V, D, TContext>,
    config: C,
    dependencies: DependencyValuesType<D>,
    context: TContext
  ) {
    let next = async (config: C): Promise<V | undefined> => {
      // Validate config with Zod schema if provided
      if (resource.configSchema) {
        try {
          config = resource.configSchema.parse(config);
        } catch (error) {
          throw new Error(`Resource config validation failed for ${resource.id.toString()}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      if (resource.init) {
        return resource.init.call(null, config, dependencies, context);
      }
    };

    const existingMiddlewares = resource.middleware;
    const createdMiddlewares = [
      ...this.store.getEverywhereMiddlewareForResources(
        existingMiddlewares.map((x) => x.id)
      ),
      ...existingMiddlewares,
    ];

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
