import type { StoreRegistry } from "../store/StoreRegistry";
import type { IDependentNode } from "./findCircularDependencies";
import { isOptional, isEvent, isTag, isTagStartup } from "../../define";
import {
  resolveApplicableSubtreeResourceMiddlewares,
  resolveApplicableSubtreeTaskMiddlewareEntries,
} from "../../tools/subtreeMiddleware";

const getDependencyId = (
  registry: StoreRegistry,
  dependency: unknown,
): string | undefined => {
  const target = isOptional(dependency) ? dependency.inner : dependency;
  return registry.resolveDefinitionId(target);
};

const getTagDependencyId = (
  registry: StoreRegistry,
  dependency: unknown,
): string | undefined => {
  const raw: unknown = isOptional(dependency) ? dependency.inner : dependency;
  const tagValue: unknown = isTagStartup(raw) ? raw.tag : raw;

  if (!isTag(tagValue)) {
    return undefined;
  }

  return registry.resolveDefinitionId(tagValue);
};

function resolveDefinitionId(
  registry: StoreRegistry,
  reference: unknown,
): string | undefined {
  return registry.resolveDefinitionId(reference);
}

function resolveTagDependencyNodes(
  registry: StoreRegistry,
  nodeMap: Map<string, IDependentNode>,
  consumerId: string,
  tagId: string,
): IDependentNode[] {
  const matches: IDependentNode[] = [];
  const pushIfMatch = (definition: {
    id: string;
    tags?: Array<{ id: string }>;
  }): void => {
    if (definition.id === consumerId) {
      return;
    }

    if (
      !definition.tags?.some((tag) => {
        const resolvedTagId = resolveDefinitionId(registry, tag);
        return (resolvedTagId ?? tag.id) === tagId;
      })
    ) {
      return;
    }

    if (!registry.visibilityTracker.isAccessible(definition.id, consumerId)) {
      return;
    }

    const node = nodeMap.get(definition.id)!;
    matches.push(node);
  };

  for (const task of registry.tasks.values()) {
    pushIfMatch(task.task);
  }

  for (const resource of registry.resources.values()) {
    pushIfMatch(resource.resource);
  }

  for (const hook of registry.hooks.values()) {
    pushIfMatch(hook.hook);
  }

  for (const middleware of registry.taskMiddlewares.values()) {
    pushIfMatch(middleware.middleware);
  }

  for (const middleware of registry.resourceMiddlewares.values()) {
    pushIfMatch(middleware.middleware);
  }

  return matches;
}

function attachDependency(
  node: IDependentNode,
  key: string,
  value: unknown,
  registry: StoreRegistry,
  nodeMap: Map<string, IDependentNode>,
): void {
  const tagId = getTagDependencyId(registry, value);
  if (tagId) {
    const tagNodes = resolveTagDependencyNodes(
      registry,
      nodeMap,
      node.id,
      tagId,
    );
    for (const tagNode of tagNodes) {
      node.dependencies[`tag:${tagId}:${tagNode.id}`] = tagNode;
    }
    return;
  }

  const depId = getDependencyId(registry, value);
  if (!depId) {
    return;
  }

  const depNode = nodeMap.get(depId);
  if (depNode) {
    node.dependencies[key] = depNode;
  }
}

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
  const dependents: IDependentNode[] = [];

  // First, create all nodes
  const nodeMap = new Map<string, IDependentNode>();

  // Create nodes for tasks
  setupBlankNodes(registry, nodeMap, dependents);

  // Now, populate dependencies with references to actual nodes
  const subtreeLookup = {
    getOwnerResourceId: (itemId: string) =>
      registry.visibilityTracker.getOwnerResourceId(itemId),
    getResource: (resourceId: string) =>
      registry.resources.get(resourceId)?.resource,
  };

  for (const task of registry.tasks.values()) {
    const node = nodeMap.get(task.task.id)!;

    // Add task dependencies
    if (task.task.dependencies) {
      for (const [depKey, depItem] of Object.entries(task.task.dependencies)) {
        attachDependency(node, depKey, depItem, registry, nodeMap);
      }
    }

    // Add local middleware dependencies for tasks (hooks have no middleware)
    const t = task.task;
    for (const middleware of t.middleware) {
      const middlewareId = resolveDefinitionId(registry, middleware);
      if (!middlewareId) {
        continue;
      }
      const middlewareNode = nodeMap.get(middlewareId);
      if (!middlewareNode) {
        continue;
      }
      node.dependencies[middlewareId] = middlewareNode;
    }

    const localMiddlewareIds = new Set(
      t.middleware
        .map((middleware) => resolveDefinitionId(registry, middleware))
        .filter((middlewareId): middlewareId is string =>
          Boolean(middlewareId),
        ),
    );
    for (const entry of resolveApplicableSubtreeTaskMiddlewareEntries(
      subtreeLookup,
      t,
    )) {
      const { middleware, duplicateKey, dependencyKey } = entry;
      const middlewareId = resolveDefinitionId(registry, middleware);
      if (!middlewareId) {
        continue;
      }
      if (localMiddlewareIds.has(duplicateKey)) {
        continue;
      }

      const middlewareNode = nodeMap.get(middlewareId);
      if (!middlewareNode) {
        continue;
      }
      node.dependencies[dependencyKey] = middlewareNode;
    }
  }

  // Populate task middleware dependencies
  for (const storeTaskMiddleware of registry.taskMiddlewares.values()) {
    const node = nodeMap.get(storeTaskMiddleware.middleware.id)!;
    const { middleware } = storeTaskMiddleware;

    if (middleware.dependencies) {
      for (const [depKey, depItem] of Object.entries(middleware.dependencies)) {
        attachDependency(node, depKey, depItem, registry, nodeMap);
      }
    }
  }

  // Populate resource middleware dependencies
  for (const storeResourceMiddleware of registry.resourceMiddlewares.values()) {
    const node = nodeMap.get(storeResourceMiddleware.middleware.id)!;
    const { middleware } = storeResourceMiddleware;
    if (middleware.dependencies) {
      for (const [depKey, depItem] of Object.entries(middleware.dependencies)) {
        attachDependency(node, depKey, depItem, registry, nodeMap);
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
        attachDependency(node, depKey, depItem, registry, nodeMap);
      }
    }

    // Add local middleware dependencies
    for (const middleware of resource.resource.middleware) {
      const middlewareId = resolveDefinitionId(registry, middleware);
      if (!middlewareId) {
        continue;
      }
      const middlewareNode = nodeMap.get(middlewareId);
      if (!middlewareNode) {
        continue;
      }
      node.dependencies[middlewareId] = middlewareNode;
    }

    const localMiddlewareIds = new Set(
      resource.resource.middleware
        .map((middleware) => resolveDefinitionId(registry, middleware))
        .filter((middlewareId): middlewareId is string =>
          Boolean(middlewareId),
        ),
    );
    for (const middleware of resolveApplicableSubtreeResourceMiddlewares(
      subtreeLookup,
      resource.resource,
    )) {
      const middlewareId = resolveDefinitionId(registry, middleware);
      if (!middlewareId) {
        continue;
      }
      if (localMiddlewareIds.has(middlewareId)) {
        continue;
      }

      const middlewareNode = nodeMap.get(middlewareId);
      if (!middlewareNode) {
        continue;
      }
      node.dependencies[`__subtree.middleware.${middlewareId}`] =
        middlewareNode;
    }
  }

  for (const hook of registry.hooks.values()) {
    const node = nodeMap.get(hook.hook.id)!;
    if (hook.hook.dependencies) {
      for (const [depKey, depItem] of Object.entries(hook.hook.dependencies)) {
        attachDependency(node, depKey, depItem, registry, nodeMap);
      }
    }
  }

  return dependents;
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
    const on = h.hook.on;
    if (on === "*") continue; // avoid over-reporting for global hooks
    const listened = registry
      .resolveHookTargets(h.hook)
      .map((entry) => entry.event.id);

    // Collect event dependencies from the hook
    const depEvents: string[] = [];
    const deps = h.hook.dependencies;
    if (deps) {
      for (const value of Object.values(deps)) {
        // For optional wrappers, extract the inner value
        const candidate = isOptional(value) ? value.inner : value;
        if (candidate && isEvent(candidate)) {
          const dependentEventId = resolveDefinitionId(registry, candidate)!;
          depEvents.push(dependentEventId);
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
