import type { ITask } from "../types/task";
import type { IResource } from "../types/resource";
import type { StoreRegistry } from "../models/StoreRegistry";
import { isTask, isResource, isEvent, isOptional } from "../definers/tools";
import type { DependencyMapType } from "../types/utilities";

/**
 * Collects all declared error ids from a task or resource definition and its
 * entire dependency chain: own throws, middleware throws (local + everywhere),
 * resource dependency throws (with their middleware), and — for tasks — hook
 * throws on events the task can emit.
 *
 * Designed for introspection, documentation, and error-contract tooling.
 * Returns a deduplicated list of normalized error id strings.
 */
export function getAllThrows(
  registry: StoreRegistry,
  target: ITask<any, any, any, any, any, any> | IResource<any, any, any, any>,
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const collect = (ids: readonly string[] | undefined) => {
    if (!ids) return;
    for (const id of ids) {
      if (seen.has(id)) continue;
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

// ── Task aggregation ───────────────────────────────────────────────────

function collectTaskThrows(
  registry: StoreRegistry,
  task: ITask<any, any, any, any, any, any>,
  seen: Set<string>,
  collect: Collector,
): void {
  // 1. Task's own throws
  collect(task.throws);

  // 2. Local middleware attached to the task
  collectMiddlewareThrows(task.middleware, collect);

  // 3. Global ("everywhere") task middleware that applies to this task
  collectEverywhereTaskMiddlewareThrows(registry, task, collect);

  // 4. Resource dependencies — collect their throws + resource middleware
  collectDependencyResourceThrows(registry, task.dependencies, seen, collect);

  // 5. Hooks listening to events this task can emit
  collectHookThrowsForEventDeps(registry, task.dependencies, collect);
}

// ── Resource aggregation ───────────────────────────────────────────────

function collectResourceThrows(
  registry: StoreRegistry,
  resource: IResource<any, any, any, any>,
  seen: Set<string>,
  collect: Collector,
): void {
  // 1. Resource's own throws
  collect(resource.throws);

  // 2. Local middleware attached to the resource
  collectMiddlewareThrows(resource.middleware, collect);

  // 3. Global ("everywhere") resource middleware that applies to this resource
  collectEverywhereResourceMiddlewareThrows(registry, resource, collect);

  // 4. Resource dependencies — collect their throws + resource middleware
  collectDependencyResourceThrows(
    registry,
    resource.dependencies,
    seen,
    collect,
  );
}

// ── Middleware helpers ─────────────────────────────────────────────────

function collectMiddlewareThrows(
  middleware: readonly { id: string }[],
  collect: Collector,
): void {
  for (const mw of middleware) {
    const throws = (mw as { throws?: readonly string[] }).throws;
    collect(throws);
  }
}

function collectEverywhereTaskMiddlewareThrows(
  registry: StoreRegistry,
  task: ITask<any, any, any, any, any, any>,
  collect: Collector,
): void {
  // Already-collected local middleware ids — skip those to avoid double-counting
  const localIds = new Set(task.middleware.map((m: { id: string }) => m.id));

  for (const entry of registry.taskMiddlewares.values()) {
    if (localIds.has(entry.middleware.id)) continue;

    const flag = entry.middleware.everywhere;
    if (!flag) continue;

    const applies = typeof flag === "function" ? flag(task) : flag === true;
    if (applies) {
      collect(entry.middleware.throws);
    }
  }
}

function collectEverywhereResourceMiddlewareThrows(
  registry: StoreRegistry,
  resource: IResource<any, any, any, any>,
  collect: Collector,
): void {
  const localIds = new Set(
    resource.middleware.map((m: { id: string }) => m.id),
  );

  for (const entry of registry.resourceMiddlewares.values()) {
    if (localIds.has(entry.middleware.id)) continue;

    const flag = entry.middleware.everywhere;
    if (!flag) continue;

    const applies = typeof flag === "function" ? flag(resource) : flag === true;
    if (applies) {
      collect(entry.middleware.throws);
    }
  }
}

// ── Dependency traversal ──────────────────────────────────────────────

function collectDependencyResourceThrows(
  registry: StoreRegistry,
  dependencies: DependencyMapType | (() => DependencyMapType) | undefined,
  seen: Set<string>,
  collect: Collector,
): void {
  const resolved = resolveDependencies(dependencies);
  if (!resolved) return;

  for (const dep of Object.values(resolved)) {
    const unwrapped = unwrapOptional(dep);
    if (!isResource(unwrapped)) continue;

    // Avoid infinite recursion on circular resource deps
    const depKey = `resource:${unwrapped.id}`;
    if (seen.has(depKey)) continue;
    seen.add(depKey);

    collect(unwrapped.throws);
    collectMiddlewareThrows(unwrapped.middleware, collect);
    collectEverywhereResourceMiddlewareThrows(registry, unwrapped, collect);

    // Recurse into the resource's own resource-deps
    collectDependencyResourceThrows(
      registry,
      unwrapped.dependencies,
      seen,
      collect,
    );
  }
}

// ── Hook-event matching ───────────────────────────────────────────────

function collectHookThrowsForEventDeps(
  registry: StoreRegistry,
  dependencies: DependencyMapType | (() => DependencyMapType),
  collect: Collector,
): void {
  // Task dependencies are always defined (ITask.dependencies is required)
  const resolved = resolveDependencies(dependencies)!;

  // Gather event ids this task can emit
  const emittedEventIds = new Set<string>();
  for (const dep of Object.values(resolved)) {
    const unwrapped = unwrapOptional(dep);
    if (unwrapped && isEvent(unwrapped)) {
      emittedEventIds.add(unwrapped.id);
    }
  }

  if (emittedEventIds.size === 0) return;

  // Scan hooks — collect throws from those listening to any of the emitted events
  for (const entry of registry.hooks.values()) {
    const on = entry.hook.on;
    if (hookListensToAny(on, emittedEventIds)) {
      collect(entry.hook.throws);
    }
  }
}

function hookListensToAny(
  on: "*" | { id: string } | readonly { id: string }[],
  eventIds: Set<string>,
): boolean {
  // Wildcard hooks listen to everything
  if (on === "*") return true;

  if (Array.isArray(on)) {
    return (on as readonly { id: string }[]).some((e) => eventIds.has(e.id));
  }

  // Single event
  return eventIds.has((on as { id: string }).id);
}

// ── Utility ───────────────────────────────────────────────────────────

function resolveDependencies(
  deps: DependencyMapType | (() => DependencyMapType) | undefined,
): DependencyMapType | undefined {
  if (!deps) return undefined;
  if (typeof deps === "function") {
    return (deps as () => DependencyMapType)();
  }
  return deps;
}

function unwrapOptional(dep: unknown): unknown {
  if (dep && typeof dep === "object" && isOptional(dep)) {
    return dep.inner;
  }
  return dep;
}
