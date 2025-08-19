import {
  DependencyMapType,
  IEventDefinition,
  IResource,
  ITask,
  IResourceWithConfig,
  RegisterableItems,
  ITaskMiddleware,
  IResourceMiddleware,
  symbolMiddlewareEverywhereResources,
  symbolMiddlewareEverywhereTasks,
  IEvent,
  ITag,
  IHook,
  symbolTaskMiddleware,
  symbolResourceMiddleware,
} from "../defs";
import { IDependentNode } from "../tools/findCircularDependencies";
import * as utils from "../define";
import { UnknownItemTypeError } from "../errors";
import {
  TaskStoreElementType,
  TaskMiddlewareStoreElementType,
  ResourceMiddlewareStoreElementType,
  ResourceStoreElementType,
  EventStoreElementType,
  HookStoreElementType,
} from "../defs";
import { StoreValidator } from "./StoreValidator";

type StoringMode = "normal" | "override";
export class StoreRegistry {
  public tasks: Map<string, TaskStoreElementType> = new Map();
  public resources: Map<string, ResourceStoreElementType> = new Map();
  public events: Map<string, EventStoreElementType> = new Map();
  public taskMiddlewares: Map<string, TaskMiddlewareStoreElementType> =
    new Map();
  public resourceMiddlewares: Map<string, ResourceMiddlewareStoreElementType> =
    new Map();
  public hooks: Map<string, HookStoreElementType> = new Map();
  public tags: Map<string, ITag> = new Map();

  private validator: StoreValidator;

  constructor() {
    this.validator = new StoreValidator(this);
  }

  getValidator(): StoreValidator {
    return this.validator;
  }

  storeGenericItem<C>(item: RegisterableItems) {
    if (utils.isTask(item)) {
      this.storeTask<C>(item);
    } else if (utils.isHook && utils.isHook(item)) {
      this.storeHook<C>(item as IHook);
    } else if (utils.isResource(item)) {
      this.storeResource<C>(item);
    } else if (utils.isEvent(item)) {
      this.storeEvent<C>(item);
    } else if (utils.isTaskMiddleware(item)) {
      this.storeTaskMiddleware<C>(item as ITaskMiddleware<any>);
    } else if (utils.isResourceMiddleware(item)) {
      this.storeResourceMiddleware<C>(item as IResourceMiddleware<any>);
    } else if (utils.isResourceWithConfig(item)) {
      this.storeResourceWithConfig<C>(item);
    } else if (utils.isTag(item)) {
      this.storeTag(item);
    } else {
      throw new UnknownItemTypeError(item);
    }
  }

  storeTag(item: ITag<any, any>) {
    this.validator.checkIfIDExists(item.id);
    this.tags.set(item.id, item);
  }

  storeHook<C>(item: IHook<any, any>, overrideMode: StoringMode = "normal") {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);

    const hook = this.getFreshValue(item, this.hooks, "hook", overrideMode);

    // store separately
    this.hooks.set(hook.id, {
      hook,
      computedDependencies: hook.dependencies,
    });
  }

  storeTaskMiddleware<C>(
    item: ITaskMiddleware<any>,
    storingMode: StoringMode = "normal",
  ) {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);

    const middleware = this.getFreshValue(
      item,
      this.taskMiddlewares,
      "middleware",
      storingMode,
    );

    this.taskMiddlewares.set(item.id, {
      middleware,
      computedDependencies: middleware.dependencies,
    });
  }

  storeResourceMiddleware<C>(
    item: IResourceMiddleware<any>,
    overrideMode: StoringMode = "normal",
  ) {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);
    const middleware = this.getFreshValue(
      item,
      this.resourceMiddlewares,
      "middleware",
      overrideMode,
    );

    this.resourceMiddlewares.set(item.id, {
      middleware,
      computedDependencies: middleware.dependencies,
    });
  }

  storeEvent<C>(item: IEvent<void>) {
    this.validator.checkIfIDExists(item.id);
    this.events.set(item.id, { event: item });
  }

  storeResourceWithConfig<C>(
    item: IResourceWithConfig<any, any, any>,
    storingMode: StoringMode = "normal",
  ) {
    storingMode === "normal" &&
      this.validator.checkIfIDExists(item.resource.id);

    const prepared = this.getFreshValue(
      item.resource,
      this.resources,
      "resource",
      storingMode,
      item.config,
    );

    this.resources.set(prepared.id, {
      resource: prepared,
      config: item.config,
      value: undefined,
      isInitialized: false,
      context: {},
    });

    this.computeRegistrationDeeply(prepared, item.config);
    return prepared;
  }

  computeRegistrationDeeply<C>(element: IResource<C>, config?: C) {
    const items =
      typeof element.register === "function"
        ? element.register(config as C)
        : element.register;

    element.register = items;

    for (const item of items) {
      // will call registration if it detects another resource.
      this.storeGenericItem<C>(item);
    }
  }

  storeResource<C>(
    item: IResource<any, any, any>,
    overrideMode: StoringMode = "normal",
  ) {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);

    const prepared = this.getFreshValue(
      item,
      this.resources,
      "resource",
      overrideMode,
    );

    this.resources.set(prepared.id, {
      resource: prepared,
      config: {},
      value: undefined,
      isInitialized: false,
      context: prepared.context?.() || {},
    });

    this.computeRegistrationDeeply(prepared, {});
    return prepared;
  }

  storeTask<C>(item: ITask<any, any, {}>, storingMode: StoringMode = "normal") {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);

    const task = this.getFreshValue(item, this.tasks, "task", storingMode);

    this.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });
  }

  /**
   * TRM = tasks, resources and middlewares
   */
  storeEventsForAllTRM() {
    // Lifecycle events removed; no-op retained for API compatibility
  }

  /**
   * @deprecated
   * @param task
   * @returns
   */
  getEverywhereMiddlewareForTasks(
    task: ITask<any, any, any, any>,
  ): ITaskMiddleware[] {
    return Array.from(this.taskMiddlewares.values())
      .filter((x) => {
        const flag = x.middleware[symbolMiddlewareEverywhereTasks];
        if (!flag) return false;

        const deps = x.middleware.dependencies as DependencyMapType;
        const isDependency = this.idExistsAsMiddlewareDependency(task.id, deps);
        // If the middleware depends on the task, it should not be applied to the task, we exclude it.
        if (isDependency) return false;

        if (typeof flag === "function") {
          return flag(task);
        }
        return Boolean(flag);
      })
      .map((x) => x.middleware);
  }

  /**
   * Returns all global middleware for resource, which do not depend on the target resource.
   * @deprecated
   */
  getEverywhereMiddlewareForResources(
    target: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    return Array.from(this.resourceMiddlewares.values())
      .filter((x) => {
        const flag = x.middleware[symbolMiddlewareEverywhereResources];
        if (!flag) return false;

        // If the middleware depends on the target resource, it should not be applied to the target resource
        const isDependency = this.idExistsAsMiddlewareDependency(
          target.id,
          x.middleware.dependencies,
        );
        // If it's a direct dependency we exclude it.
        return !isDependency;
      })
      .map((x) => x.middleware);
  }

  private idExistsAsMiddlewareDependency(id: string, deps: DependencyMapType) {
    return Object.values(deps).some((x: any) => {
      const candidate = utils.isOptional(x) ? (x as any).inner : x;
      return (candidate as any)?.id === id;
    });
  }

  getDependentNodes() {
    const depenedants: IDependentNode[] = [];

    // First, create all nodes
    const nodeMap = new Map<string, IDependentNode>();
    // Create nodes for tasks
    for (const task of this.tasks.values()) {
      const node: IDependentNode = {
        id: task.task.id,
        dependencies: {},
      };
      nodeMap.set(task.task.id, node);
      depenedants.push(node);
    }

    for (const middleware of this.taskMiddlewares.values()) {
      const node: IDependentNode = {
        id: middleware.middleware.id,
        dependencies: {},
      };
      nodeMap.set(middleware.middleware.id, node);
      depenedants.push(node);
    }

    for (const middleware of this.resourceMiddlewares.values()) {
      const node: IDependentNode = {
        id: middleware.middleware.id,
        dependencies: {},
      };
      nodeMap.set(middleware.middleware.id, node);
      depenedants.push(node);
    }

    // Create nodes for resources
    for (const resource of this.resources.values()) {
      const node: IDependentNode = {
        id: resource.resource.id,
        dependencies: {},
      };
      nodeMap.set(resource.resource.id, node);
      depenedants.push(node);
    }

    for (const hook of this.hooks.values()) {
      const node: IDependentNode = {
        id: hook.hook.id,
        dependencies: {},
      };
      nodeMap.set(hook.hook.id, node);
      depenedants.push(node);
    }

    // Now, populate dependencies with references to actual nodes
    for (const task of this.tasks.values()) {
      const node = nodeMap.get(task.task.id)!;

      // Add task dependencies
      if (task.task.dependencies) {
        for (const [depKey, depItem] of Object.entries(
          task.task.dependencies,
        )) {
          const candidate = utils.isOptional(depItem) ? depItem.inner : depItem;
          const depNode = nodeMap.get(candidate.id);
          if (depNode) {
            node.dependencies[depKey] = depNode;
          }
        }
      }

      // Add local middleware dependencies for tasks (hooks have no middleware)
      const t = task.task;
      for (const middleware of t.middleware) {
        const middlewareNode = nodeMap.get(middleware.id);
        if (middlewareNode) {
          node.dependencies[middleware.id] = middlewareNode;
        }
      }

      // Add global middleware dependencies for tasks
      const perTaskMiddleware = this.getEverywhereMiddlewareForTasks(task.task);
      for (const middleware of perTaskMiddleware) {
        const middlewareNode = nodeMap.get(middleware.id);
        if (middlewareNode) {
          node.dependencies[middleware.id] = middlewareNode;
        }
      }
    }

    // Populate task middleware dependencies
    for (const middleware of this.taskMiddlewares.values()) {
      const node = nodeMap.get(middleware.middleware.id)!;

      if (middleware.middleware.dependencies) {
        for (const [depKey, depItem] of Object.entries(
          middleware.middleware.dependencies,
        )) {
          const candidate = utils.isOptional(depItem) ? depItem.inner : depItem;

          const depNode = nodeMap.get(candidate.id);
          if (depNode) {
            node.dependencies[depKey] = depNode;
          }
        }
      }
    }

    // Populate resource middleware dependencies
    for (const middleware of this.resourceMiddlewares.values()) {
      const node = nodeMap.get(middleware.middleware.id)!;

      if (middleware.middleware.dependencies) {
        for (const [depKey, depItem] of Object.entries(
          middleware.middleware.dependencies,
        )) {
          const candidate = utils.isOptional(depItem) ? depItem.inner : depItem;

          const depNode = nodeMap.get(candidate.id);
          if (depNode) {
            node.dependencies[depKey] = depNode;
          }
        }
      }
    }

    // Populate resource dependencies
    for (const resource of this.resources.values()) {
      const node = nodeMap.get(resource.resource.id)!;

      // Add resource dependencies
      if (resource.resource.dependencies) {
        for (const [depKey, depItem] of Object.entries(
          resource.resource.dependencies,
        )) {
          const candidate = utils.isOptional(depItem) ? depItem.inner : depItem;

          const depNode = nodeMap.get(candidate.id);
          if (depNode) {
            node.dependencies[depKey] = depNode;
          }
        }
      }

      // Add local middleware dependencies
      for (const middleware of resource.resource.middleware) {
        const middlewareNode = nodeMap.get(middleware.id);
        if (middlewareNode) {
          node.dependencies[middleware.id] = middlewareNode;
        }
      }

      // Add global middleware dependencies for resources
      const perResourceMiddleware = this.getEverywhereMiddlewareForResources(
        resource.resource,
      );

      for (const middleware of perResourceMiddleware) {
        const middlewareNode = nodeMap.get(middleware.id);
        if (middlewareNode) {
          node.dependencies[middleware.id] = middlewareNode;
        }
      }
    }

    for (const hook of this.hooks.values()) {
      const node = nodeMap.get(hook.hook.id)!;
      if (hook.hook.dependencies) {
        for (const [depKey, depItem] of Object.entries(
          hook.hook.dependencies,
        )) {
          const candidate = utils.isOptional(depItem) ? depItem.inner : depItem;
          const depNode = nodeMap.get(candidate.id);

          if (depNode) {
            node.dependencies[depKey] = depNode;
          }
        }
      }
    }

    return depenedants;
  }

  getTasksWithTag(tag: string | ITag) {
    const tagId = typeof tag === "string" ? tag : tag.id;

    return Array.from(this.tasks.values())
      .filter((x) => {
        return x.task.tags.some((t) => t.id === tagId);
      })
      .map((x) => x.task);
  }

  getResourcesWithTag(tag: string | ITag) {
    const tagId = typeof tag === "string" ? tag : tag.id;

    return Array.from(this.resources.values())
      .filter((x) => {
        return x.resource.tags.some((t) => t.id === tagId);
      })
      .map((x) => x.resource);
  }

  /**
   * Used to fetch the value cloned, and if we're dealing with an override, we need to extend the previous value.
   */
  private getFreshValue<
    T extends { id: string; dependencies?: any; config?: any },
    MapType,
  >(
    item: T,
    collection: Map<string, MapType>,
    key: keyof MapType,
    overrideMode: StoringMode,
    config?: any, // If provided config, takes precedence over config in item.
  ): T {
    let currentItem: T;
    if (overrideMode === "override") {
      const existing = collection.get(item.id)![key];
      currentItem = { ...existing, ...item };
    } else {
      currentItem = { ...item };
    }

    currentItem.dependencies =
      typeof currentItem.dependencies === "function"
        ? currentItem.dependencies(config || currentItem.config)
        : currentItem.dependencies;

    return currentItem;
  }
}
