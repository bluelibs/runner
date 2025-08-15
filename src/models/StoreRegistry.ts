import {
  DependencyMapType,
  IMiddlewareDefinition,
  IEventDefinition,
  IResource,
  ITask,
  IResourceWithConfig,
  RegisterableItems,
  IMiddleware,
  symbolMiddlewareEverywhereResources,
  symbolMiddlewareEverywhereTasks,
  IEvent,
  ITag,
} from "../defs";
import { IDependentNode } from "../tools/findCircularDependencies";
import * as utils from "../define";
import { UnknownItemTypeError } from "../errors";
import {
  TaskStoreElementType,
  MiddlewareStoreElementType,
  ResourceStoreElementType,
  EventStoreElementType,
} from "./StoreTypes";
import { StoreValidator } from "./StoreValidator";

export class StoreRegistry {
  public tasks: Map<string | symbol, TaskStoreElementType> = new Map();
  public resources: Map<string | symbol, ResourceStoreElementType> = new Map();
  public events: Map<string | symbol, EventStoreElementType> = new Map();
  public middlewares: Map<string | symbol, MiddlewareStoreElementType> =
    new Map();

  private validator: StoreValidator;

  constructor() {
    this.validator = new StoreValidator(
      this.tasks,
      this.resources,
      this.events,
      this.middlewares
    );
  }

  getValidator(): StoreValidator {
    return this.validator;
  }

  storeGenericItem<C>(item: RegisterableItems) {
    if (utils.isTask(item)) {
      this.storeTask<C>(item);
    } else if (utils.isResource(item)) {
      this.storeResource<C>(item);
    } else if (utils.isEvent(item)) {
      this.storeEvent<C>(item);
    } else if (utils.isMiddleware(item)) {
      this.storeMiddleware<C>(item);
    } else if (utils.isResourceWithConfig(item)) {
      this.storeResourceWithConfig<C>(item);
    } else {
      throw new UnknownItemTypeError(item);
    }
  }

  storeMiddleware<C>(item: IMiddleware<any>, check = true) {
    check && this.validator.checkIfIDExists(item.id);

    item.dependencies =
      typeof item.dependencies === "function"
        ? item.dependencies(item.config)
        : item.dependencies;

    this.middlewares.set(item.id, {
      middleware: item,
      computedDependencies: {},
    });
  }

  storeEvent<C>(item: IEvent<void>) {
    this.validator.checkIfIDExists(item.id);
    this.events.set(item.id, { event: item });
  }

  storeResourceWithConfig<C>(
    item: IResourceWithConfig<any, any, any>,
    check = true
  ) {
    check && this.validator.checkIfIDExists(item.resource.id);

    this.prepareResource(item.resource, item.config);

    this.resources.set(item.resource.id, {
      resource: item.resource,
      config: item.config,
      value: undefined,
      isInitialized: false,
      context: {},
    });

    this.computeRegistrationDeeply(item.resource, item.config);
    return item.resource;
  }

  computeRegistrationDeeply<C>(element: IResource<C>, config?: C) {
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

  storeResource<C>(item: IResource<any, any, any>, check = true) {
    check && this.validator.checkIfIDExists(item.id);

    this.prepareResource(item, {});

    this.resources.set(item.id, {
      resource: item,
      config: {},
      value: undefined,
      isInitialized: false,
      context: item.context?.() || {},
    });

    this.computeRegistrationDeeply(item, {});
    return item;
  }

  storeTask<C>(item: ITask<any, any, {}>, check = true) {
    check && this.validator.checkIfIDExists(item.id);

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

  storeEventsForAllTasks() {
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

  getEverywhereMiddlewareForTasks(
    task: ITask<any, any, any, any>
  ): IMiddleware[] {
    return Array.from(this.middlewares.values())
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
   */
  getEverywhereMiddlewareForResources(
    target: IResource<any, any, any, any>
  ): IMiddleware[] {
    return Array.from(this.middlewares.values())
      .filter((x) => {
        const isGlobal = x.middleware[symbolMiddlewareEverywhereResources];
        if (!isGlobal) return false;

        // If the middleware depends on the target resource, it should not be applied to the target resource
        const isDependency = this.idExistsAsMiddlewareDependency(
          target.id,
          x.middleware.dependencies
        );
        // If it's a direct dependency we exclude it.
        return !isDependency;
      })
      .map((x) => x.middleware);
  }

  private idExistsAsMiddlewareDependency(
    id: string | symbol,
    deps: DependencyMapType
  ) {
    return Object.values(deps).some((x) => x.id === id);
  }

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

  getDependentNodes() {
    const depenedants: IDependentNode[] = [];

    // First, create all nodes
    const nodeMap = new Map<string | symbol, IDependentNode>();

    // Create nodes for tasks
    for (const task of this.tasks.values()) {
      const node: IDependentNode = {
        id: task.task.id.toString(),
        dependencies: {},
      };
      nodeMap.set(task.task.id, node);
      depenedants.push(node);
    }

    // Create nodes for middleware
    for (const middleware of this.middlewares.values()) {
      const node: IDependentNode = {
        id: middleware.middleware.id.toString(),
        dependencies: {},
      };
      nodeMap.set(middleware.middleware.id, node);
      depenedants.push(node);
    }

    // Create nodes for resources
    for (const resource of this.resources.values()) {
      const node: IDependentNode = {
        id: resource.resource.id.toString(),
        dependencies: {},
      };
      nodeMap.set(resource.resource.id, node);
      depenedants.push(node);
    }

    // Now, populate dependencies with references to actual nodes
    for (const task of this.tasks.values()) {
      const node = nodeMap.get(task.task.id)!;

      // Add task dependencies
      if (task.task.dependencies) {
        for (const [depKey, depItem] of Object.entries(
          task.task.dependencies
        )) {
          if (depItem && typeof depItem === "object" && "id" in depItem) {
            const depNode = nodeMap.get((depItem as any).id);
            if (depNode) {
              node.dependencies[depKey] = depNode;
            }
          }
        }
      }

      // Add local middleware dependencies
      for (const middleware of task.task.middleware) {
        const middlewareNode = nodeMap.get(middleware.id);
        if (middlewareNode) {
          node.dependencies[middleware.id.toString()] = middlewareNode;
        }
      }

      // Add global middleware dependencies for tasks
      const perTaskMiddleware = this.getEverywhereMiddlewareForTasks(task.task);
      for (const middleware of perTaskMiddleware) {
        const middlewareNode = nodeMap.get(middleware.id);
        if (middlewareNode) {
          node.dependencies[middleware.id.toString()] = middlewareNode;
        }
      }
    }

    // Populate middleware dependencies
    for (const middleware of this.middlewares.values()) {
      const node = nodeMap.get(middleware.middleware.id)!;

      if (middleware.middleware.dependencies) {
        for (const [depKey, depItem] of Object.entries(
          middleware.middleware.dependencies
        )) {
          if (depItem && typeof depItem === "object" && "id" in depItem) {
            const depNode = nodeMap.get((depItem as any).id);
            if (depNode) {
              node.dependencies[depKey] = depNode;
            }
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
          resource.resource.dependencies
        )) {
          if (depItem && typeof depItem === "object" && "id" in depItem) {
            const depNode = nodeMap.get((depItem as any).id);
            if (depNode) {
              node.dependencies[depKey] = depNode;
            }
          }
        }
      }

      // Add local middleware dependencies
      for (const middleware of resource.resource.middleware) {
        const middlewareNode = nodeMap.get(middleware.id);
        if (middlewareNode) {
          node.dependencies[middleware.id.toString()] = middlewareNode;
        }
      }

      // Add global middleware dependencies for resources
      const perResourceMiddleware = this.getEverywhereMiddlewareForResources(
        resource.resource
      );

      for (const middleware of perResourceMiddleware) {
        const middlewareNode = nodeMap.get(middleware.id);
        if (middlewareNode) {
          node.dependencies[middleware.id.toString()] = middlewareNode;
        }
      }
    }

    return depenedants;
  }

  getTasksWithTag(tag: string | ITag) {
    if (typeof tag === "string") {
      return Array.from(this.tasks.values()).filter((x) =>
        x.task.meta?.tags?.includes(tag)
      );
    }

    return Array.from(this.tasks.values())
      .filter((x) => tag.extract(x.task.meta?.tags))
      .map((x) => x.task);
  }

  getResourcesWithTag(tag: string | ITag) {
    if (typeof tag === "string") {
      return Array.from(this.resources.values()).filter((x) =>
        x.resource.meta?.tags?.includes(tag)
      );
    }

    return Array.from(this.resources.values())
      .filter((x) => tag.extract(x.resource.meta?.tags))
      .map((x) => x.resource);
  }
}
