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
  symbolEvent,
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
  ITag,
} from "../defs";

/**
 * Type guard: checks if a definition is a Task.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Task.
 */
export function isTask(definition: any): definition is ITask {
  return definition && definition[symbolTask];
}

/**
 * Type guard: checks if a definition is a Resource.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Resource.
 */
export function isResource(definition: any): definition is IResource {
  return definition && definition[symbolResource];
}

/**
 * Type guard: checks if a definition is a Resource that carries config via `.with()`.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded ResourceWithConfig.
 */
export function isResourceWithConfig(
  definition: any,
): definition is IResourceWithConfig {
  return definition && definition[symbolResourceWithConfig];
}

/**
 * Type guard: checks if a definition is an Event.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Event.
 */
export function isEvent(definition: any): definition is IEvent {
  return definition && definition[symbolEvent];
}

/** Type guard: checks if a definition is a Hook. */
export function isHook(definition: any): definition is IHook {
  return definition && definition[symbolHook];
}

/**
 * Type guard: checks if a definition is a Middleware.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Middleware.
 */
export function isTaskMiddleware(
  definition: any,
): definition is ITaskMiddleware {
  return definition && definition[symbolTaskMiddleware];
}

export function isResourceMiddleware(
  definition: any,
): definition is IResourceMiddleware {
  return definition && definition[symbolResourceMiddleware];
}

/**
 * Type guard: checks if a definition is a Tag.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Tag.
 */
export function isTag(definition: any): definition is ITag {
  return definition && definition[symbolTag];
}

/** Type guard: checks if a definition is an Optional Dependency wrapper. */
export function isOptional(
  definition: any,
): definition is IOptionalDependency<any> {
  return definition && definition[symbolOptionalDependency];
}