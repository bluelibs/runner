import type { StoreRegistry } from "../StoreRegistry";
import type { IDependentNode } from "./findCircularDependencies";
import type { IEvent } from "../../defs";
import { isOptional, isEvent } from "../../define";

const readStringId = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
};

const getDependencyId = (dependency: unknown): string | undefined =>
  readStringId(
    isOptional(dependency)
      ? (dependency as { inner: unknown }).inner
      : dependency,
  );

/**
 * Creates blank dependency nodes for every registered task, middleware, resource,
 * and hook. Populates both the shared nodeMap and the flat dependents list.
 */
function setupBlankNodes(
  registry: StoreRegistry,
  nodeMap: Map<string, IDependentNode>,
  dependents: IDependentNode[],
): void {
  for (const task of registry.tasks.values()) {
    const node: IDependentNode = {
      id: task.task.id,
      dependencies: {},
    };
    nodeMap.set(task.task.id, node);
    dependents.push(node);
  }

  for (const middleware of registry.taskMiddlewares.values()) {
    const node: IDependentNode = {
      id: middleware.middleware.id,
      dependencies: {},
    };
    nodeMap.set(middleware.middleware.id, node);
    dependents.push(node);
  }

  for (const middleware of registry.resourceMiddlewares.values()) {
    const node: IDependentNode = {
      id: middleware.middleware.id,
      dependencies: {},
    };
    nodeMap.set(middleware.middleware.id, node);
    dependents.push(node);
  }

  // Create nodes for resources
  for (const resource of registry.resources.values()) {
    const node: IDependentNode = {
      id: resource.resource.id,
      dependencies: {},
    };
    nodeMap.set(resource.resource.id, node);
    dependents.push(node);
  }

  for (const hook of registry.hooks.values()) {
    const node: IDependentNode = {
      id: hook.hook.id,
      dependencies: {},
    };
    nodeMap.set(hook.hook.id, node);
    dependents.push(node);
  }
}

/**
 * Builds a dependency graph of all registered items (tasks, resources, middlewares, hooks).
 * Returns a flat list of dependency nodes suitable for circular-dependency detection.
 */
export function buildDependencyGraph(
  registry: StoreRegistry,
): IDependentNode[] {
  const depenedants: IDependentNode[] = [];

  // First, create all nodes
  const nodeMap = new Map<string, IDependentNode>();

  // Create nodes for tasks
  setupBlankNodes(registry, nodeMap, depenedants);

  // Now, populate dependencies with references to actual nodes
  for (const task of registry.tasks.values()) {
    const node = nodeMap.get(task.task.id)!;

    // Add task dependencies
    if (task.task.dependencies) {
      for (const [depKey, depItem] of Object.entries(task.task.dependencies)) {
        const depId = getDependencyId(depItem);
        if (!depId) {
          continue;
        }
        const depNode = nodeMap.get(depId);
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
  }

  // Populate task middleware dependencies
  for (const storeTaskMiddleware of registry.taskMiddlewares.values()) {
    const node = nodeMap.get(storeTaskMiddleware.middleware.id)!;
    const { middleware } = storeTaskMiddleware;

    if (middleware.dependencies) {
      for (const [depKey, depItem] of Object.entries(middleware.dependencies)) {
        const depId = getDependencyId(depItem);
        if (!depId) {
          continue;
        }
        const depNode = nodeMap.get(depId);
        if (depNode) {
          node.dependencies[depKey] = depNode;
        }
      }
    }

    if (middleware.everywhere) {
      const filter =
        typeof middleware.everywhere === "function"
          ? middleware.everywhere
          : () => true;

      for (const task of registry.tasks.values()) {
        if (filter(task.task)) {
          const taskNode = nodeMap.get(task.task.id)!;
          // node.dependencies[task.task.id] = taskNode;
          taskNode.dependencies[`__middleware.${middleware.id}`] = node;
        }
      }
    }
  }

  // Populate resource middleware dependencies
  for (const storeResourceMiddleware of registry.resourceMiddlewares.values()) {
    const node = nodeMap.get(storeResourceMiddleware.middleware.id)!;
    const { middleware } = storeResourceMiddleware;
    if (middleware.dependencies) {
      for (const [depKey, depItem] of Object.entries(middleware.dependencies)) {
        const depId = getDependencyId(depItem);
        if (!depId) {
          continue;
        }
        const depNode = nodeMap.get(depId);
        if (depNode) {
          node.dependencies[depKey] = depNode;
        }
      }
    }

    if (middleware.everywhere) {
      const filter =
        typeof middleware.everywhere === "function"
          ? middleware.everywhere
          : () => true;

      for (const resource of registry.resources.values()) {
        if (filter(resource.resource)) {
          const resourceNode = nodeMap.get(resource.resource.id)!;
          // node.dependencies[resource.resource.id] = resourceNode;
          resourceNode.dependencies[`__middleware.${middleware.id}`] = node;
        }
      }
    }
  }

  // Populate resource dependencies
  for (const resource of registry.resources.values()) {
    const node = nodeMap.get(resource.resource.id)!;

    // Add resource dependencies
    if (resource.resource.dependencies) {
      for (const [depKey, depItem] of Object.entries(
        resource.resource.dependencies,
      )) {
        const depId = getDependencyId(depItem);
        if (!depId) {
          continue;
        }
        const depNode = nodeMap.get(depId);
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
  }

  for (const hook of registry.hooks.values()) {
    const node = nodeMap.get(hook.hook.id)!;
    if (hook.hook.dependencies) {
      for (const [depKey, depItem] of Object.entries(hook.hook.dependencies)) {
        const depId = getDependencyId(depItem);
        if (!depId) {
          continue;
        }
        const depNode = nodeMap.get(depId);

        if (depNode) {
          node.dependencies[depKey] = depNode;
        }
      }
    }
  }

  return depenedants;
}

/**
 * Builds a directed graph of event emissions based on hooks listening to events
 * and their dependencies on events (emission capability). Ignores wildcard hooks by default.
 */
export function buildEventEmissionGraph(
  registry: StoreRegistry,
): IDependentNode[] {
  const nodes = new Map<string, IDependentNode>();

  // Create nodes for all events
  for (const e of registry.events.values()) {
    nodes.set(e.event.id, { id: e.event.id, dependencies: {} });
  }

  // For each hook, if it listens to concrete event(s) and depends on events, add edges listenedEvent -> depEvent
  for (const h of registry.hooks.values()) {
    const listened: string[] = [];
    const on = h.hook.on;
    if (on === "*") continue; // avoid over-reporting for global hooks
    if (Array.isArray(on))
      listened.push(...(on as IEvent[]).map((e: IEvent) => e.id));
    else listened.push((on as IEvent).id);

    // Collect event dependencies from the hook
    const depEvents: string[] = [];
    const deps = h.hook.dependencies;
    if (deps) {
      for (const value of Object.values(deps)) {
        // For optional wrappers, extract the inner value
        const candidate: { id?: string } = isOptional(value)
          ? (value as { inner: { id?: string } }).inner
          : (value as { id?: string });
        if (candidate && isEvent(candidate)) {
          depEvents.push(candidate.id);
        }
      }
    }

    // Add edges
    for (const srcId of listened) {
      const srcNode = nodes.get(srcId);
      if (!srcNode) continue; // skip unknown/unregistered events
      for (const dstId of depEvents) {
        if (srcId === dstId) continue; // ignore trivial self edge
        const dstNode = nodes.get(dstId);
        if (dstNode) {
          srcNode.dependencies[dstId] = dstNode;
        }
      }
    }
  }

  return Array.from(nodes.values());
}
