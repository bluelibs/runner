import {
  DependencyMapType,
  DependencyValuesType,
  IMiddlewareDefinition,
  IEventDefinition,
  IResource,
  ITask,
  IResourceWithConfig,
  RegisterableItems,
  symbols,
  IMiddleware,
} from "./defs";
import * as utils from "./define";
import { IDependentNode } from "./tools/findCircularDependencies";
import { globalEventsArray } from "./globalEvents";
import { Errors } from "./errors";
import { globalResources } from "./globalResources";
import { EventManager } from "./EventManager";
import { TaskRunner } from "./TaskRunner";

export type ResourceStoreElementType<
  C = any,
  V = any,
  D extends DependencyMapType = {}
> = {
  resource: IResource<C, V, D>;
  computedDependencies?: DependencyValuesType<D>;
  config: C;
  value: V;
  isInitialized?: boolean;
};

export type TaskStoreElementType<
  Input = any,
  Output extends Promise<any> = any,
  D extends DependencyMapType = any
> = {
  task: ITask<Input, Output, D>;
  computedDependencies: DependencyValuesType<D>;
  isInitialized: boolean;
};

export type MiddlewareStoreElementType<TDeps extends DependencyMapType = any> =
  {
    middleware: IMiddleware<TDeps>;
    computedDependencies: DependencyValuesType<TDeps>;
  };

export type EventStoreElementType = {
  event: IEventDefinition;
};

/**
 * @internal This should be used for testing purposes only.
 */
export class Store {
  root!: ResourceStoreElementType;
  public tasks: Map<string, TaskStoreElementType> = new Map();
  public resources: Map<string, ResourceStoreElementType> = new Map();
  public events: Map<string, EventStoreElementType> = new Map();
  public middlewares: Map<string, MiddlewareStoreElementType> = new Map();

  constructor(protected readonly eventManager: EventManager) {}

  /**
   * Store the root before beginning registration
   * @param root
   * @param config
   */
  initializeStore(root: IResource<any>, config: any) {
    this.storeGenericItem(globalResources.eventManager.with(this.eventManager));
    this.storeGenericItem(globalResources.store.with(this));

    root.dependencies =
      typeof root.dependencies === "function"
        ? root.dependencies(config)
        : root.dependencies;

    this.root = {
      resource: root,
      computedDependencies: {},
      config,
      value: undefined,
      isInitialized: false,
    };

    // register global events
    globalEventsArray.forEach((event) => {
      this.storeEvent(event);
    });

    this.resources.set(root.id, this.root);
  }

  /**
   * Beginning with the root, we perform registering to the container all the resources, tasks, middleware and events.
   * @param element
   * @param config
   */
  computeRegisterOfResource<C>(element: IResource<C>, config?: C) {
    const items =
      typeof element.register === "function"
        ? element.register(config as C)
        : element.register;

    for (const item of items) {
      this.storeGenericItem<C>(item);
    }
  }

  /**
   * middlewares are already stored in their final form and the check for them would be redundant
   * @param id
   */
  protected checkIfIDExists(id: string): void | never {
    if (this.tasks.has(id)) {
      throw Errors.duplicateRegistration("Task", id);
    }
    if (this.resources.has(id)) {
      throw Errors.duplicateRegistration("Resource", id);
    }
    if (this.events.has(id)) {
      throw Errors.duplicateRegistration("Event", id);
    }
  }

  public getGlobalMiddlewares(excludingIds: string[]): IMiddleware[] {
    return Array.from(this.middlewares.values())
      .filter((x) => x.middleware[symbols.middlewareGlobal])
      .filter((x) => !excludingIds.includes(x.middleware.id))
      .map((x) => x.middleware);
  }

  /**
   * If you want to register something to the store you can use this function.
   * @param item
   */
  public storeGenericItem<C>(item: RegisterableItems) {
    if (utils.isTask(item)) {
      this.storeTask<C>(item);
    } else if (utils.isResource(item)) {
      // Registration a simple resource, which is interpreted as a resource with no configuration.
      this.storeResource<C>(item);
    } else if (utils.isEvent(item)) {
      this.storeEvent<C>(item);
    } else if (utils.isMiddleware(item)) {
      if (this.middlewares.has(item.id)) {
        throw Errors.duplicateRegistration("Middleware", item.id);
      }

      item.dependencies =
        typeof item.dependencies === "function"
          ? item.dependencies()
          : item.dependencies;

      this.middlewares.set(item.id, {
        middleware: item,
        computedDependencies: {},
      });
    } else if (utils.isResourceWithConfig(item)) {
      this.storeResourceWithConfig<C>(item);
    } else {
      throw Errors.unknownItemType(item);
    }
  }

  public storeEvent<C>(item: IEventDefinition<void>) {
    this.checkIfIDExists(item.id);

    this.events.set(item.id, { event: item });
  }

  private storeResourceWithConfig<C>(item: IResourceWithConfig<any, any, any>) {
    this.checkIfIDExists(item.resource.id);

    this.resources.set(item.resource.id, {
      resource: item.resource,
      config: item.config,
      value: undefined,
      isInitialized: false,
    });

    this.computeRegisterOfResource(item.resource, item.config);
  }

  private storeResource<C>(item: IResource<any, any, any>) {
    this.checkIfIDExists(item.id);

    this.storeEvent(item.events.beforeInit);
    this.storeEvent(item.events.afterInit);
    this.storeEvent(item.events.onError);

    item.dependencies =
      typeof item.dependencies === "function"
        ? item.dependencies()
        : item.dependencies;

    this.resources.set(item.id, {
      resource: item,
      config: {},
      value: undefined,
      isInitialized: false,
    });

    this.computeRegisterOfResource(item, {});
  }

  private storeTask<C>(item: ITask<any, any, {}>) {
    this.checkIfIDExists(item.id);

    item.dependencies =
      typeof item.dependencies === "function"
        ? item.dependencies()
        : item.dependencies;

    this.storeEvent(item.events.beforeRun);
    this.storeEvent(item.events.afterRun);
    this.storeEvent(item.events.onError);

    this.tasks.set(item.id, {
      task: item,
      computedDependencies: {},
      isInitialized: false,
    });
  }

  getDependentNodes(): IDependentNode[] {
    const depenedants: IDependentNode[] = [];
    for (const task of this.tasks.values()) {
      depenedants.push({
        id: task.task.id,
        dependencies: task.task.dependencies,
      });
    }
    for (const middleware of this.middlewares.values()) {
      depenedants.push({
        id: middleware.middleware.id,
        dependencies: middleware.middleware.dependencies,
      });
    }
    for (const resource of this.resources.values()) {
      depenedants.push({
        id: resource.resource.id,
        dependencies: resource.resource.dependencies || {},
      });
    }

    return depenedants;
  }
}
