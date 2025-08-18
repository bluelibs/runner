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
import { TaskRunner } from "./TaskRunner";
import { globalResources } from "../globals/globalResources";
import { requireContextMiddleware } from "../globals/middleware/requireContext.middleware";
import { retryMiddleware } from "../globals/middleware/retry.middleware";
import { timeoutMiddleware } from "../globals/middleware/timeout.middleware";
import { OnUnhandledError } from "./UnhandledError";

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
  private taskRunner?: TaskRunner;
  public onUnhandledError?: OnUnhandledError;

  #isLocked = false;
  #isInitialized = false;

  constructor(
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
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
  get tags() {
    return this.registry.tags;
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
    const builtInResourcesMap = new Map<
      IResource<any, any, any, any, any>,
      any
    >();
    builtInResourcesMap.set(globalResources.store, this);
    builtInResourcesMap.set(globalResources.eventManager, this.eventManager);
    builtInResourcesMap.set(globalResources.logger, this.logger);
    builtInResourcesMap.set(globalResources.taskRunner, this.taskRunner!);
    this.registry.storeGenericItem(globalResources.queue);

    for (const [resource, value] of builtInResourcesMap.entries()) {
      this.registry.storeGenericItem(resource);
      const entry = this.resources.get(resource.id);
      if (entry) {
        entry.value = value;
        entry.isInitialized = true;
      }
    }

    // Register global events
    globalEventsArray.forEach((event) => {
      this.registry.storeEvent(event);
    });

    // Register built-in middlewares
    const builtInMiddlewares = [
      requireContextMiddleware,
      retryMiddleware,
      timeoutMiddleware,
    ];
    builtInMiddlewares.forEach((middleware) => {
      this.registry.middlewares.set(middleware.id, {
        middleware,
        computedDependencies: {},
      });
    });
  }

  public setTaskRunner(taskRunner: TaskRunner) {
    this.taskRunner = taskRunner;
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
      if (resource.isInitialized && resource.resource.dispose) {
        await resource.resource.dispose(
          resource.value,
          resource.config,
          resource.computedDependencies as any,
          resource.context,
        );
      }
    }
  }

  public processOverrides() {
    this.overrideManager.processOverrides();
  }

  public getEverywhereMiddlewareForTasks(
    task: ITask<any, any, any, any>,
  ): IMiddleware[] {
    return this.registry.getEverywhereMiddlewareForTasks(task);
  }

  public getEverywhereMiddlewareForResources(
    resource: IResource<any, any, any, any>,
  ): IMiddleware[] {
    return this.registry.getEverywhereMiddlewareForResources(resource);
  }

  public storeGenericItem<C>(item: RegisterableItems) {
    return this.registry.storeGenericItem<C>(item);
  }

  public storeEventsForAllTRM() {
    this.registry.storeEventsForAllTRM();
  }

  /**
   * Returns all tasks with the given tag.
   * @param tag - The tag to filter by.
   * @returns The tasks with the given tag.
   */
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
