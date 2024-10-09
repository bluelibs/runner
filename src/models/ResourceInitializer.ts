import {
  DependencyMapType,
  DependencyValuesType,
  ITask,
  IResource,
} from "../defs";
import { EventManager } from "./EventManager";
import { globalEvents } from "../globalEvents";
import { MiddlewareStoreElementType, Store } from "./Store";
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
    TValue = any,
    TDeps extends DependencyMapType = {}
  >(
    resource: IResource<TConfig, TValue, TDeps>,
    config: TConfig,
    dependencies: DependencyValuesType<TDeps>
  ): Promise<TValue | undefined> {
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

    let error, value;
    try {
      if (resource.init) {
        value = await this.initWithMiddleware(resource, config, dependencies);
      }

      await this.eventManager.emit(
        resource.events.afterInit,
        {
          config,
          value,
        },
        resource.id
      );
      await this.eventManager.emit(
        globalEvents.resources.afterInit,
        {
          config,
          resource,
          value,
        },
        resource.id
      );

      this.logger.debug(`Resource ${resource.id} initialized`, resource.id);

      return value;
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
          error,
          suppress,
        },
        resource.id
      );
      await this.eventManager.emit(
        globalEvents.resources.onError,
        {
          error,
          resource,
          suppress,
        },
        resource.id
      );

      if (!isSuppressed) throw e;
    }
  }

  public async initWithMiddleware<C, V, D extends DependencyMapType>(
    resource: IResource<C, V>,
    config: C,
    dependencies: D
  ) {
    let next = async (config: C): Promise<V | undefined> => {
      if (resource.init) {
        return resource.init.call(null, config, dependencies);
      }
    };

    const existingMiddlewares = resource.middleware;
    const createdMiddlewares = [
      ...this.store.getGlobalMiddlewares(existingMiddlewares.map((x) => x.id)),
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
            resourceDefinition: resource as any,
            config: config,
            next: nextFunction,
          },
          storeMiddleware.computedDependencies
        );
      };
    }

    return next(config);
  }
}
