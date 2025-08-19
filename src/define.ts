/**
 * Factory functions for defining tasks, resources, events and middleware.
 *
 * These helpers create strongly-typed definitions while also wiring internal
 * metadata: anonymous IDs, file path tags (for better debugging), lifecycle
 * events, and global middleware flags. See README for high-level concepts.
 */

// Re-export all define functions from their separate files
export { defineTask } from "./definers/defineTask";
export { defineHook } from "./definers/defineHook";
export { defineResource } from "./definers/defineResource";
export { defineEvent } from "./definers/defineEvent";
export { defineTaskMiddleware } from "./definers/defineTaskMiddleware";
export { defineResourceMiddleware } from "./definers/defineResourceMiddleware";
export { defineOverride } from "./definers/defineOverride";
export { defineTag } from "./definers/defineTag";

// Re-export type guards and utility functions
export {
  isTask,
  isResource,
  isResourceWithConfig,
  isEvent,
  isHook,
  isTaskMiddleware,
  isResourceMiddleware,
  isTag,
  isOptional,
} from "./definers/tools";

