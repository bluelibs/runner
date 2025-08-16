import {
  DependencyMapType,
  IResource,
  ITask,
  RegisterableItems,
  IMiddleware,
  ITag,
} from "../defs";
import { IDependentNode } from "../tools/findCircularDependencies";
import { globalEventsArray } from "../globals/globalEvents";
import { StoreAlreadyInitializedError } from "../errors";
import { EventManager } from "./EventManager";
import { Logger } from "./Logger";
import { StoreRegistry } from "./StoreRegistry";
import { OverrideManager } from "./OverrideManager";
import { StoreValidator } from "./StoreValidator";
import {
  ResourceStoreElementType,
  TaskStoreElementType,
  MiddlewareStoreElementType,
  EventStoreElementType,
} from "./StoreTypes";
import { getBuiltInResources, getBuiltInMiddlewares } from "./StoreConstants";

// Re-export types for backward compatibility
export {
  ResourceStoreElementType,
  TaskStoreElementType,
  MiddlewareStoreElementType,
  EventStoreElementType,
};

/**
 * Store class which is used to store all the resources, tasks, middleware and events.
 */
export class Store {
  root!: ResourceStoreElementType;
  private registry: StoreRegistry;
  private overrideManager: OverrideManager;
  private validator: StoreValidator;

  #isLocked = false;
  #isInitialized = false;

  constructor(
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger
  ) {
    this.registry = new StoreRegistry();
    this.validator = this.registry.getValidator();
    this.overrideManager = new OverrideManager(this.registry);
  }

  // Delegate properties to registry
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
  get middlewares() {
    return this.registry.middlewares;
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

  lock() {
    this.#isLocked = true;
  }

  checkLock() {
    if (this.#isLocked) {
      throw new Error("Cannot modify the Store when it is locked.");
    }
  }

  private registerGlobalComponents() {
    // Register built-in resources
    const builtInResources = getBuiltInResources(this.eventManager, this);
    builtInResources.forEach((resource) => {
      this.registry.storeGenericItem(resource);
    });

    // Register global events
    globalEventsArray.forEach((event) => {
      this.registry.storeEvent(event);
    });

    // Register built-in middlewares
    const builtInMiddlewares = getBuiltInMiddlewares();
    builtInMiddlewares.forEach((middleware) => {
      this.registry.middlewares.set(middleware.id, {
        middleware,
        computedDependencies: {},
      });
    });
  }

  private setupRootResource(root: IResource<any>, config: any) {
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

    this.registry.computeRegistrationDeeply(root, config);
    this.registry.resources.set(root.id, this.root);
  }

  initializeStore(root: IResource<any, any, any, any, any>, config: any) {
    if (this.#isInitialized) {
      throw new StoreAlreadyInitializedError();
    }

    this.registerGlobalComponents();
    this.setupRootResource(root, config);
    this.validator.runSanityChecks();

    for (const resource of this.resources.values()) {
      this.overrideManager.storeOverridesDeeply(resource.resource);
    }

    this.#isInitialized = true;
  }

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

  public processOverrides() {
    this.overrideManager.processOverrides();
  }

  public getEverywhereMiddlewareForTasks(
    task: ITask<any, any, any, any>
  ): IMiddleware[] {
    return this.registry.getEverywhereMiddlewareForTasks(task);
  }

  public getEverywhereMiddlewareForResources(
    resource: IResource<any, any, any, any>
  ): IMiddleware[] {
    return this.registry.getEverywhereMiddlewareForResources(resource);
  }

  public storeGenericItem<C>(item: RegisterableItems) {
    return this.registry.storeGenericItem<C>(item);
  }

  public storeEventsForAllTRM() {
    this.registry.storeEventsForAllTRM();
  }

  public getTasksWithTag(tag: string | ITag) {
    return this.registry.getTasksWithTag(tag);
  }

  public getResourcesWithTag(tag: string | ITag) {
    return this.registry.getResourcesWithTag(tag);
  }

  getDependentNodes(): IDependentNode[] {
    return this.registry.getDependentNodes();
  }
}
