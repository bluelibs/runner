/**
 * Type guard and utility functions for checking definition types.
 */
import {
  ITask,
  IResource,
  IResourceWithConfig,
  ITaskMiddleware,
  IResourceMiddleware,
  IEvent,
  IEventLane,
  IRpcLane,
  symbolEvent,
  symbolEventLane,
  symbolRpcLane,
  symbolTask,
  symbolHook,
  symbolResourceWithConfig,
  symbolResource,
  symbolTaskMiddleware,
  symbolResourceMiddleware,
  IHook,
  IOptionalDependency,
  symbolOptionalDependency,
  symbolTag,
  symbolTagBeforeInitDependency,
  ITag,
  ITagStartupDependency,
  symbolOverrideDefinition,
} from "../defs";
import type { IsolationSubtreeFilter } from "../types/resource";
import { IErrorHelper } from "../types/error";
import { symbolAsyncContext, symbolError } from "../types/symbols";
import type { IAsyncContext } from "../types/asyncContext";

function hasBrand(definition: unknown, symbol: symbol): boolean {
  if (definition === null || definition === undefined) {
    return false;
  }
  if (typeof definition !== "object" && typeof definition !== "function") {
    return false;
  }
  return Boolean((definition as Record<symbol, unknown>)[symbol]);
}

/**
 * Type guard: checks if a definition is a Task.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Task.
 */
export function isTask(definition: unknown): definition is ITask {
  return hasBrand(definition, symbolTask);
}

/**
 * Type guard: checks if a definition is a Resource.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Resource.
 */
export function isResource(definition: unknown): definition is IResource {
  return hasBrand(definition, symbolResource);
}

/**
 * Type guard: checks if a definition is a Resource that carries config via `.with()`.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded ResourceWithConfig.
 */
export function isResourceWithConfig(
  definition: unknown,
): definition is IResourceWithConfig {
  return hasBrand(definition, symbolResourceWithConfig);
}

/**
 * Type guard: checks if a definition is an Event.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Event.
 */
export function isEvent(definition: unknown): definition is IEvent {
  return hasBrand(definition, symbolEvent);
}

/** Type guard: checks if a definition is an Event Lane reference. */
export function isEventLane(definition: unknown): definition is IEventLane {
  return hasBrand(definition, symbolEventLane);
}

/** Type guard: checks if a definition is an RPC Lane reference. */
export function isRpcLane(definition: unknown): definition is IRpcLane {
  return hasBrand(definition, symbolRpcLane);
}

/** Type guard: checks if a definition is a Hook. */
export function isHook(definition: unknown): definition is IHook {
  return hasBrand(definition, symbolHook);
}

/**
 * Type guard: checks if a definition is a Middleware.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Middleware.
 */
export function isTaskMiddleware(
  definition: unknown,
): definition is ITaskMiddleware {
  return hasBrand(definition, symbolTaskMiddleware);
}

export function isResourceMiddleware(
  definition: unknown,
): definition is IResourceMiddleware {
  return hasBrand(definition, symbolResourceMiddleware);
}

/**
 * Type guard: checks if a definition is a Tag.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Tag.
 */
export function isTag(definition: unknown): definition is ITag {
  return hasBrand(definition, symbolTag);
}

/** Type guard: checks if a dependency is a before-init tag wrapper. */
export function isTagStartup(
  definition: unknown,
): definition is ITagStartupDependency<ITag<any, any, any, any>> {
  return hasBrand(definition, symbolTagBeforeInitDependency);
}

/** Type guard: checks if a definition is an Optional Dependency wrapper. */
export function isOptional(
  definition: unknown,
): definition is IOptionalDependency<any> {
  return hasBrand(definition, symbolOptionalDependency);
}

/** Type guard: checks if a definition is an Error helper. */
export function isError(definition: unknown): definition is IErrorHelper<any> {
  return hasBrand(definition, symbolError);
}

/** Type guard: checks if a definition is an Async Context. */
export function isAsyncContext(
  definition: unknown,
): definition is IAsyncContext<any> {
  return hasBrand(definition, symbolAsyncContext);
}

/** Type guard: checks if a definition is an override produced by override APIs. */
export function isOverrideDefinition(definition: unknown): boolean {
  return hasBrand(definition, symbolOverrideDefinition);
}

/**
 * Type guard: checks if a value is an `IsolationSubtreeFilter` created by `subtreeOf()`.
 * Used in the wiring validation path to distinguish structural resource references
 * from flat id strings or tag definitions in deny/only policy entries.
 */
export function isSubtreeFilter(
  definition: unknown,
): definition is IsolationSubtreeFilter {
  return (
    typeof definition === "object" &&
    definition !== null &&
    (definition as IsolationSubtreeFilter)._subtreeFilter === true
  );
}

/**
 * Type guard: checks if a value is an `IsolationScope` created by `scope()`.
 * Used in the wiring validation path to distinguish channel-scoped entries
 * from bare definitions or subtree filters in deny/only policy entries.
 */
export function isIsolationScope(
  definition: unknown,
): definition is import("../tools/scope").IsolationScope {
  return (
    typeof definition === "object" &&
    definition !== null &&
    (definition as { _isolationScope?: boolean })._isolationScope === true
  );
}
