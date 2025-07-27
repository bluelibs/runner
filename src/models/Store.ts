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
} from "../defs";
import * as utils from "../define";
import { IDependentNode } from "../tools/findCircularDependencies";
import { globalEventsArray } from "../globalEvents";
import { Errors } from "../errors";
import { globalResources } from "../globalResources";
import { EventManager } from "./EventManager";
import { TaskRunner } from "./TaskRunner";
import { Logger } from "./Logger";
import { requireContextMiddleware } from "../context";

export type ResourceStoreElementType<
  C = any,
  V = any,
  D extends DependencyMapType = {},
  TContext = any
> = {
  resource: IResource<C, V, D>;
  computedDependencies?: DependencyValuesType<D>;
  config: C;
  value: V;
  context: TContext;
  isInitialized?: boolean;
};

export type TaskStoreElementType<
  Input = any,
  Output extends Promise<any> = any,
  D extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition | undefined = any
> = {
  task: ITask<Input, Output, D, TOn>;
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
 * Store class which is used to store all the resources, tasks, middleware and events.
 */
export class Store {
  root!: ResourceStoreElementType;
  public tasks: Map<string, TaskStoreElementType> = new Map();
  public resources: Map<string, ResourceStoreElementType> = new Map();
  public events: Map<string, EventStoreElementType> = new Map();
  public middlewares: Map<string, MiddlewareStoreElementType> = new Map();
  public overrides: Map<
    string,
    IResource | IMiddleware | ITask | IResourceWithConfig
  > = new Map();
  /**
   * This is because we can have multiple overrides at once, and the final override is the one that is used.
   */
  public overrideRequests: Set<{
    source: string;
    override: RegisterableItems;
  }> = new Set();

  #isLocked = false;
  #isInitialized = false;

  constructor(
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger
  ) {}

  get isLocked() {
    return this.#isLocked;
  }

  lock() {
    this.#isLocked = true;
    this.eventManager.lock();
  }

  checkLock() {
    if (this.#isLocked) {
      throw new Error("Cannot modify the Store when it is locked.");
    }
  }

  initializeStore(root: IResource<any>, config: any) {
    if (this.#isInitialized) {
      throw Errors.storeAlreadyInitialized();
    }

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
      context: {},
    };

    // register global events
    globalEventsArray.forEach((event) => {
      this.storeEvent(event);
    });

    this.computeRegistrationDeeply(root, config);
    this.resources.set(root.id, this.root);

    // If this evolves, split into a separate method
    this.middlewares.set(requireContextMiddleware.id, {
      middleware: requireContextMiddleware,
      computedDependencies: {},
    });

    this.runSanityChecks();

    for (const resource of this.resources.values()) {
      this.storeOverridesDeeply(resource.resource);
    }

    this.#isInitialized = true;
  }

  private runSanityChecks() {
    for (const task of this.tasks.values()) {
      task.task.middleware.forEach((middleware) => {
        if (!this.middlewares.has(middleware.id)) {
          throw Errors.dependencyNotFound(
            `Middleware ${middleware.id} in Task ${task.task.id}`
          );
        }
      });
    }
  }

  /**
   * Beginning with the root, we perform registering to the container all the resources, tasks, middleware and events.
   * @param element
   * @param config
   */
  private computeRegistrationDeeply<C>(element: IResource<C>, config?: C) {
    const items =
      typeof element.register === "function"
        ? element.register(config as C)
        : element.register;

    // if it was a computed function ensure the registered terms are stored, not the function.
    element.register = items;

    for (const item of items) {
      // will call registration if it detects another resource.
      this.storeGenericItem<C>(item);
    }
  }

  /**
   * @param element
   */
  private storeOverridesDeeply<C>(element: IResource<C, any, any>) {
    element.overrides.forEach((override) => {
      // We go deeply for resources, because we want to store all the overrides first
      // the one on top has priority of setting the last override.
      if (utils.isResource(override)) {
        this.storeOverridesDeeply(override);
      }

      let id: string;
      if (utils.isResourceWithConfig(override)) {
        this.storeOverridesDeeply(override.resource);
        id = override.resource.id;
      } else {
        id = override.id;
      }

      this.overrideRequests.add({ source: element.id, override });
      this.overrides.set(id, override);
    });
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
    if (this.middlewares.has(id)) {
      throw Errors.duplicateRegistration("Middleware", id);
    }
  }

  /**
   * Cleanup
   */
  public async dispose() {
    for (const resource of this.resources.values()) {
      if (resource.resource.dispose) {
        await resource.resource.dispose(
          resource.value,
          resource.config,
          resource.computedDependencies as DependencyMapType,
          resource.context
        );
      }
    }
  }

  /**
   * When this is called, all overrides should have been stored in the "overrides" store.
   */
  public processOverrides() {
    // If we are trying to use override on something that wasn't previously registered, we throw an error.
    for (const override of this.overrides.values()) {
      let hasAnyItem = false;
      if (utils.isTask(override)) {
        hasAnyItem = this.tasks.has(override.id);
      } else if (utils.isResource(override)) {
        hasAnyItem = this.resources.has(override.id);
      } else if (utils.isMiddleware(override)) {
        hasAnyItem = this.middlewares.has(override.id);
      } else if (utils.isResourceWithConfig(override)) {
        hasAnyItem = this.resources.has(override.resource.id);
      }

      if (!hasAnyItem) {
        const id = utils.isResourceWithConfig(override)
          ? override.resource.id
          : override.id;

        throw Errors.dependencyNotFound(id);
      }
    }

    for (const override of this.overrides.values()) {
      if (utils.isTask(override)) {
        this.storeTask(override, false);
      } else if (utils.isResource(override)) {
        this.storeResource(override, false);
      } else if (utils.isMiddleware(override)) {
        this.storeMiddleware(override, false);
      } else if (utils.isResourceWithConfig(override)) {
        this.storeResourceWithConfig(override, false);
      }
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
      this.storeMiddleware<C>(item);
    } else if (utils.isResourceWithConfig(item)) {
      this.storeResourceWithConfig<C>(item);
    } else {
      throw Errors.unknownItemType(item);
    }
  }

  private storeMiddleware<C>(item: IMiddleware<any>, check = true) {
    check && this.checkIfIDExists(item.id);

    item.dependencies =
      typeof item.dependencies === "function"
        ? item.dependencies()
        : item.dependencies;

    this.middlewares.set(item.id, {
      middleware: item,
      computedDependencies: {},
    });
  }

  public storeEvent<C>(item: IEventDefinition<void>) {
    this.checkIfIDExists(item.id);

    this.events.set(item.id, { event: item });
  }

  private storeResourceWithConfig<C>(
    item: IResourceWithConfig<any, any, any>,
    check = true
  ) {
    check && this.checkIfIDExists(item.resource.id);

    this.prepareResource(item.resource, item.config);

    this.resources.set(item.resource.id, {
      resource: item.resource,
      config: item.config,
      value: undefined,
      isInitialized: false,
      context: {},
    });

    this.computeRegistrationDeeply(item.resource, item.config);
  }

  /**
   * This is for storing a resource without a config.
   * @param item
   */
  private storeResource<C>(item: IResource<any, any, any>, check = true) {
    check && this.checkIfIDExists(item.id);

    this.prepareResource(item, {});

    this.resources.set(item.id, {
      resource: item,
      config: {},
      value: undefined,
      isInitialized: false,
      context: item.context?.() || {},
    });

    this.computeRegistrationDeeply(item, {});
  }

  public storeEventsForAllTasks() {
    for (const task of this.tasks.values()) {
      this.storeEvent(task.task.events.beforeRun);
      this.storeEvent(task.task.events.afterRun);
      this.storeEvent(task.task.events.onError);
    }

    for (const resource of this.resources.values()) {
      this.storeEvent(resource.resource.events.beforeInit);
      this.storeEvent(resource.resource.events.afterInit);
      this.storeEvent(resource.resource.events.onError);
    }
  }

  /**
   * This is for storing a resource without a config.
   * @param item
   */
  private prepareResource<C>(
    item: IResource<any, any, any>,
    config: any
  ): IResource<any, any, any> {
    item.dependencies =
      typeof item.dependencies === "function"
        ? item.dependencies(config)
        : item.dependencies;

    return item;
  }

  private storeTask<C>(item: ITask<any, any, {}>, check = true) {
    check && this.checkIfIDExists(item.id);

    item.dependencies =
      typeof item.dependencies === "function"
        ? item.dependencies()
        : item.dependencies;

    this.tasks.set(item.id, {
      task: item,
      computedDependencies: {},
      isInitialized: false,
    });
  }

  private middlewareAsMap(middleware: IMiddlewareDefinition[]) {
    return middleware.reduce((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {} as Record<string, IMiddlewareDefinition>);
  }

  getDependentNodes(): IDependentNode[] {
    const depenedants: IDependentNode[] = [];
    for (const task of this.tasks.values()) {
      depenedants.push({
        id: task.task.id,
        dependencies: {
          ...task.task.dependencies,
          ...this.middlewareAsMap(task.task.middleware),
        },
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
        dependencies: {
          ...resource.resource.dependencies,
          ...this.middlewareAsMap(resource.resource.middleware),
        },
      });
    }

    return depenedants;
  }
}
