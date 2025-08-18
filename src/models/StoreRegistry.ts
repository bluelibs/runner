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
  IHook,
} from "../defs";
import { IDependentNode } from "../tools/findCircularDependencies";
import * as utils from "../define";
import { UnknownItemTypeError } from "../errors";
import {
  TaskStoreElementType,
  MiddlewareStoreElementType,
  ResourceStoreElementType,
  EventStoreElementType,
} from "../defs";
import { StoreValidator } from "./StoreValidator";

export class StoreRegistry {
  public tasks: Map<string, TaskStoreElementType> = new Map();
  public resources: Map<string, ResourceStoreElementType> = new Map();
  public events: Map<string, EventStoreElementType> = new Map();
  public middlewares: Map<string, MiddlewareStoreElementType> = new Map();
  public hooks: Map<string, IHook<any, any>> = new Map();

  private validator: StoreValidator;

  constructor() {
    this.validator = new StoreValidator(
      this.tasks,
      this.resources,
      this.events,
      this.middlewares,
    );
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
    } else if (utils.isMiddleware(item)) {
      this.storeMiddleware<C>(item);
    } else if (utils.isResourceWithConfig(item)) {
      this.storeResourceWithConfig<C>(item);
    } else {
      throw new UnknownItemTypeError(item);
    }
  }

  storeHook<C>(item: IHook<any, any>, check = true) {
    check && this.validator.checkIfIDExists(item.id);

    const hook = { ...item } as IHook<any, any>;
    hook.dependencies =
      typeof item.dependencies === "function"
        ? (item.dependencies as any)()
        : item.dependencies;

    // store separately
    this.hooks.set(hook.id, hook);
  }

  storeMiddleware<C>(item: IMiddleware<any>, check = true) {
    check && this.validator.checkIfIDExists(item.id);

    const middleware = { ...item } as IMiddleware<any>;
    middleware.dependencies =
      typeof item.dependencies === "function"
        ? (item.dependencies as any)(item.config)
        : item.dependencies;

    this.middlewares.set(middleware.id, {
      middleware,
      computedDependencies: {},
    });
  }

  storeEvent<C>(item: IEvent<void>) {
    this.validator.checkIfIDExists(item.id);
    this.events.set(item.id, { event: item });
  }

  storeResourceWithConfig<C>(
    item: IResourceWithConfig<any, any, any>,
    check = true,
  ) {
    check && this.validator.checkIfIDExists(item.resource.id);

    const prepared = this.prepareResource(item.resource, item.config);

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

  storeResource<C>(item: IResource<any, any, any>, check = true) {
    check && this.validator.checkIfIDExists(item.id);

    const prepared = this.prepareResource(item, {});

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

  storeTask<C>(item: ITask<any, any, {}>, check = true) {
    check && this.validator.checkIfIDExists(item.id);

    const task = { ...item } as ITask<any, any, {}>;
    task.dependencies =
      typeof item.dependencies === "function"
        ? (item.dependencies as any)()
        : item.dependencies;

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

  getEverywhereMiddlewareForTasks(
    task: ITask<any, any, any, any>,
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
    target: IResource<any, any, any, any>,
  ): IMiddleware[] {
    return Array.from(this.middlewares.values())
      .filter((x) => {
        const isGlobal = x.middleware[symbolMiddlewareEverywhereResources];
        if (!isGlobal) return false;

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

  private prepareResource<C>(
    item: IResource<any, any, any>,
    config: any,
  ): IResource<any, any, any> {
    const cloned: IResource<any, any, any> = { ...item };
    cloned.dependencies =
      typeof item.dependencies === "function"
        ? (item.dependencies as any)(config)
        : item.dependencies;

    return cloned;
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

    // Create nodes for middleware
    for (const middleware of this.middlewares.values()) {
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

    // Now, populate dependencies with references to actual nodes
    for (const task of this.tasks.values()) {
      const node = nodeMap.get(task.task.id)!;

      // Add task dependencies
      if (task.task.dependencies) {
        for (const [depKey, depItem] of Object.entries(
          task.task.dependencies,
        )) {
          const candidate: any = utils.isOptional(depItem)
            ? (depItem as any).inner
            : depItem;
          if (candidate && typeof candidate === "object" && "id" in candidate) {
            const depNode = nodeMap.get((candidate as { id: string }).id);
            if (depNode) {
              node.dependencies[depKey] = depNode;
            }
          }
        }
      }

      // Add local middleware dependencies for tasks (hooks have no middleware)
      if (!utils.isHook(task.task)) {
        const t = task.task as ITask<any, any, any, any>;
        for (const middleware of t.middleware) {
          const middlewareNode = nodeMap.get(middleware.id);
          if (middlewareNode) {
            node.dependencies[middleware.id] = middlewareNode;
          }
        }
      }

      // Add global middleware dependencies for tasks
      if (!utils.isHook(task.task)) {
        const perTaskMiddleware = this.getEverywhereMiddlewareForTasks(
          task.task as ITask<any, any, any, any>,
        );
        for (const middleware of perTaskMiddleware) {
          const middlewareNode = nodeMap.get(middleware.id);
          if (middlewareNode) {
            node.dependencies[middleware.id] = middlewareNode;
          }
        }
      }
    }

    // Populate middleware dependencies
    for (const middleware of this.middlewares.values()) {
      const node = nodeMap.get(middleware.middleware.id)!;

      if (middleware.middleware.dependencies) {
        for (const [depKey, depItem] of Object.entries(
          middleware.middleware.dependencies,
        )) {
          const candidate: any = utils.isOptional(depItem)
            ? (depItem as any).inner
            : depItem;
          if (candidate && typeof candidate === "object" && "id" in candidate) {
            const depNode = nodeMap.get((candidate as { id: string }).id);
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
          resource.resource.dependencies,
        )) {
          const candidate: any = utils.isOptional(depItem)
            ? (depItem as any).inner
            : depItem;
          if (candidate && typeof candidate === "object" && "id" in candidate) {
            const depNode = nodeMap.get((candidate as { id: string }).id);
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

    return depenedants;
  }

  getTasksWithTag(tag: string | ITag) {
    if (typeof tag === "string") {
      return Array.from(this.tasks.values()).filter((x) =>
        x.task.meta?.tags?.includes(tag),
      );
    }

    return Array.from(this.tasks.values())
      .filter((x) => tag.extract(x.task.meta?.tags))
      .map((x) => x.task);
  }

  getResourcesWithTag(tag: string | ITag) {
    if (typeof tag === "string") {
      return Array.from(this.resources.values()).filter((x) =>
        x.resource.meta?.tags?.includes(tag),
      );
    }

    return Array.from(this.resources.values())
      .filter((x) => tag.extract(x.resource.meta?.tags))
      .map((x) => x.resource);
  }
}
