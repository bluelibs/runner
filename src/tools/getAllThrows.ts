import type { StoreRegistry } from "../models/StoreRegistry";
import type { IResource } from "../types/resource";
import type { ITask } from "../types/task";
import { isEvent, isOptional, isResource, isTask } from "../definers/tools";
import type { DependencyMapType } from "../types/utilities";
import {
  resolveApplicableSubtreeResourceMiddlewares,
  resolveApplicableSubtreeTaskMiddlewares,
} from "./subtreeMiddleware";

/**
 * Collects all declared error ids from a task or resource definition and its
 * entire dependency chain: own throws, middleware throws (local + subtree),
 * resource dependency throws (with their middleware), and - for tasks - hook
 * throws on events the task can emit.
 */
export function getAllThrows(
  registry: StoreRegistry,
  target: ITask<any, any, any, any, any, any> | IResource<any, any, any, any>,
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const collect = (ids: readonly string[] | undefined) => {
    if (!ids) {
      return;
    }

    for (const id of ids) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      result.push(id);
    }
  };

  if (isTask(target)) {
    collectTaskThrows(registry, target, seen, collect);
  } else if (isResource(target)) {
    collectResourceThrows(registry, target, seen, collect);
  }

  return result;
}

type Collector = (ids: readonly string[] | undefined) => void;

function createSubtreeLookup(registry: StoreRegistry) {
  return {
    getOwnerResourceId: (itemId: string) =>
      registry.visibilityTracker.getOwnerResourceId(itemId),
    getResource: (resourceId: string) =>
      registry.resources.get(resourceId)?.resource,
  };
}

function collectTaskThrows(
  registry: StoreRegistry,
  task: ITask<any, any, any, any, any, any>,
  seen: Set<string>,
  collect: Collector,
): void {
  collect(task.throws);
  collectMiddlewareThrows(task.middleware, collect);
  collectSubtreeTaskMiddlewareThrows(registry, task, collect);
  collectDependencyResourceThrows(registry, task.dependencies, seen, collect);
  collectHookThrowsForEventDeps(registry, task.dependencies, collect);
}

function collectResourceThrows(
  registry: StoreRegistry,
  resource: IResource<any, any, any, any>,
  seen: Set<string>,
  collect: Collector,
): void {
  collect(resource.throws);
  collectMiddlewareThrows(resource.middleware, collect);
  collectSubtreeResourceMiddlewareThrows(registry, resource, collect);
  collectDependencyResourceThrows(
    registry,
    resource.dependencies,
    seen,
    collect,
  );
}

function collectMiddlewareThrows(
  middleware: readonly { id: string }[],
  collect: Collector,
): void {
  for (const mw of middleware) {
    collect((mw as { throws?: readonly string[] }).throws);
  }
}

function collectSubtreeTaskMiddlewareThrows(
  registry: StoreRegistry,
  task: ITask<any, any, any, any, any, any>,
  collect: Collector,
): void {
  const localIds = new Set(
    task.middleware.map((middleware: { id: string }) => middleware.id),
  );
  const subtreeLookup = createSubtreeLookup(registry);

  for (const middleware of resolveApplicableSubtreeTaskMiddlewares(
    subtreeLookup,
    task,
  )) {
    if (localIds.has(middleware.id)) {
      continue;
    }

    collect(middleware.throws);
  }
}

function collectSubtreeResourceMiddlewareThrows(
  registry: StoreRegistry,
  resource: IResource<any, any, any, any>,
  collect: Collector,
): void {
  const localIds = new Set(
    resource.middleware.map((middleware) => middleware.id),
  );
  const subtreeLookup = createSubtreeLookup(registry);

  for (const middleware of resolveApplicableSubtreeResourceMiddlewares(
    subtreeLookup,
    resource,
  )) {
    if (localIds.has(middleware.id)) {
      continue;
    }

    collect(middleware.throws);
  }
}

function collectDependencyResourceThrows(
  registry: StoreRegistry,
  dependencies: DependencyMapType | (() => DependencyMapType) | undefined,
  seen: Set<string>,
  collect: Collector,
): void {
  const resolved = resolveDependencies(dependencies);
  if (!resolved) {
    return;
  }

  for (const dep of Object.values(resolved)) {
    const unwrapped = unwrapOptional(dep);
    if (!isResource(unwrapped)) {
      continue;
    }

    const depKey = `resource:${unwrapped.id}`;
    if (seen.has(depKey)) {
      continue;
    }
    seen.add(depKey);

    collect(unwrapped.throws);
    collectMiddlewareThrows(unwrapped.middleware, collect);
    collectSubtreeResourceMiddlewareThrows(registry, unwrapped, collect);
    collectDependencyResourceThrows(
      registry,
      unwrapped.dependencies,
      seen,
      collect,
    );
  }
}

function collectHookThrowsForEventDeps(
  registry: StoreRegistry,
  dependencies: DependencyMapType | (() => DependencyMapType),
  collect: Collector,
): void {
  const resolved = resolveDependencies(dependencies);
  if (!resolved) {
    return;
  }

  const emittedEventIds = new Set<string>();
  for (const dep of Object.values(resolved)) {
    const unwrapped = unwrapOptional(dep);
    if (unwrapped && isEvent(unwrapped)) {
      emittedEventIds.add(unwrapped.id);
    }
  }

  if (emittedEventIds.size === 0) {
    return;
  }

  for (const entry of registry.hooks.values()) {
    if (hookListensToAny(entry.hook.on, emittedEventIds)) {
      collect(entry.hook.throws);
    }
  }
}

function hookListensToAny(
  on: "*" | { id: string } | readonly { id: string }[],
  eventIds: Set<string>,
): boolean {
  if (on === "*") {
    return true;
  }

  if (Array.isArray(on)) {
    return on.some((eventDefinition) => eventIds.has(eventDefinition.id));
  }

  const eventDefinition = on as { id: string };
  return eventIds.has(eventDefinition.id);
}

function resolveDependencies(
  deps: DependencyMapType | (() => DependencyMapType) | undefined,
): DependencyMapType | undefined {
  if (!deps) {
    return;
  }

  if (typeof deps === "function") {
    return deps();
  }

  return deps;
}

function unwrapOptional(dep: unknown): unknown {
  if (dep && typeof dep === "object" && isOptional(dep)) {
    return dep.inner;
  }

  return dep;
}
