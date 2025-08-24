import {
  DependencyMapType,
  IResource,
  ITask,
  RegisterableItems,
  ITaskMiddleware,
  IResourceMiddleware,
  ITag,
} from "../defs";
import {
  findCircularDependencies,
  IDependentNode,
} from "./utils/findCircularDependencies";
import { globalEventsArray } from "../globals/globalEvents";
import {
  CircularDependenciesError,
  StoreAlreadyInitializedError,
} from "../errors";
import { EventManager } from "./EventManager";
import { Logger } from "./Logger";
import { StoreRegistry } from "./StoreRegistry";
import { OverrideManager } from "./OverrideManager";
import { StoreValidator } from "./StoreValidator";
import {
  ResourceStoreElementType,
  TaskStoreElementType,
  TaskMiddlewareStoreElementType,
  ResourceMiddlewareStoreElementType,
  EventStoreElementType,
} from "../types/storeTypes";
import { TaskRunner } from "./TaskRunner";
import { globalResources } from "../globals/globalResources";
import { requireContextTaskMiddleware } from "../globals/middleware/requireContext.middleware";
import {
  retryTaskMiddleware,
  retryResourceMiddleware,
} from "../globals/middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  timeoutResourceMiddleware,
} from "../globals/middleware/timeout.middleware";
import { OnUnhandledError } from "./UnhandledError";
import { globalTags } from "../globals/globalTags";
import { MiddlewareManager } from "./MiddlewareManager";

// Re-export types for backward compatibility
export {
  ResourceStoreElementType,
  TaskStoreElementType,
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
  private middlewareManager!: MiddlewareManager;

  #isLocked = false;
  #isInitialized = false;

  constructor(
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
    public readonly onUnhandledError: OnUnhandledError,
  ) {
    this.registry = new StoreRegistry(this);
    this.validator = this.registry.getValidator();
    this.overrideManager = new OverrideManager(this.registry);
    this.middlewareManager = new MiddlewareManager(this, eventManager, logger);
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
  get taskMiddlewares() {
    return this.registry.taskMiddlewares;
  }
  get resourceMiddlewares() {
    return this.registry.resourceMiddlewares;
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

  // Expose the shared MiddlewareManager instance so other components (like TaskRunner)
  // can compose runners using the same interceptor configuration.
  public getMiddlewareManager(): MiddlewareManager {
    return this.middlewareManager;
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
    builtInResourcesMap.set(
      globalResources.middlewareManager,
      this.middlewareManager,
    );

    this.registry.storeGenericItem(globalResources.queue);

    for (const [resource, value] of builtInResourcesMap.entries()) {
      this.registry.storeGenericItem(resource);
      const entry = this.resources.get(resource.id);
      if (entry) {
        entry.value = value;
        entry.isInitialized = true;
      }
    }

    // Register global tags
    Object.values(globalTags).forEach((tag) => {
      this.registry.storeTag(tag);
    });

    // Register global events
    globalEventsArray.forEach((event) => {
      this.registry.storeEvent(event);
    });

    // Register built-in middlewares
    // Built-in middlewares currently target tasks only; adjust as needed per kind
    const builtInTaskMiddlewares = [
      requireContextTaskMiddleware,
      retryTaskMiddleware,
      timeoutTaskMiddleware,
    ];
    builtInTaskMiddlewares.forEach((middleware) => {
      this.registry.taskMiddlewares.set(middleware.id, {
        middleware: middleware as any,
        computedDependencies: {},
        isInitialized: false,
      });
    });

    const builtInResourceMiddlewares = [
      retryResourceMiddleware,
      timeoutResourceMiddleware,
    ];
    builtInResourceMiddlewares.forEach((middleware) => {
      this.registry.resourceMiddlewares.set(middleware.id, {
        middleware: middleware as any,
        computedDependencies: {},
        isInitialized: false,
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

  public validateDependencyGraph() {
    // We verify that there isn't any circular dependencies before we begin computing the dependencies
    const dependentNodes = this.registry.getDependentNodes();
    const circularDependencies = findCircularDependencies(dependentNodes);
    if (circularDependencies.cycles.length > 0) {
      throw new CircularDependenciesError(circularDependencies.cycles);
    }
  }

  public initializeStore(
    root: IResource<any, any, any, any, any>,
    config: any,
  ) {
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

  public storeGenericItem<C>(item: RegisterableItems) {
    return this.registry.storeGenericItem<C>(item);
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
}
