import {
  defineTask,
  defineResource,
  defineEvent,
  defineEventLane,
  defineRpcLane,
  defineTaskMiddleware,
  defineResourceMiddleware,
  defineOverride,
  defineTag,
  defineHook,
  isTask,
  isResource,
  isResourceWithConfig,
  isEvent,
  isEventLane,
  isRpcLane,
  isHook,
  isTaskMiddleware,
  isResourceMiddleware,
  isTag,
  isTagStartup,
  isOptional,
  isError,
  isAsyncContext,
  isOverrideDefinition,
  isSubtreeFilter,
  isIsolationScope,
} from "./define";
import { defineAsyncContext } from "./definers/defineAsyncContext";
import { globalEvents } from "./globals/globalEvents";
import { globalResources } from "./globals/globalResources";
import { globalMiddlewares } from "./globals/globalMiddleware";
import { globalTags } from "./globals/globalTags";
import { debug as globalDebug } from "./globals/debug";
import { run } from "./run";
import { resource as resourceFn } from "./definers/builders/resource";
import { task as taskFn } from "./definers/builders/task";
import { event as eventFn } from "./definers/builders/event";
import { eventLane as eventLaneFn } from "./definers/builders/eventLane";
import { rpcLane as rpcLaneFn } from "./definers/builders/rpcLane";
import { hook as hookFn } from "./definers/builders/hook";
import {
  taskMiddleware as taskMiddlewareFn,
  resourceMiddleware as resourceMiddlewareFn,
} from "./definers/builders/middleware";
import { tag as tagFn } from "./definers/builders/tag";
import { error as errorFn } from "./definers/builders/error";
import { asyncContext as asyncContextFn } from "./definers/builders/asyncContext";
import { override as overrideBuilder } from "./definers/builders/override";
import { onAnyOf, isOneOf } from "./types/event";
import { subtreeOf as subtreeOfFn } from "./tools/subtreeOf";
import { scope as scopeFn } from "./tools/scope";
import { isSameDefinition } from "./tools/isSameDefinition";
import { asyncContexts } from "./asyncContexts";

/**
 * Built-in framework resources that Runner registers and exposes for dependency lookup.
 */
export const resources: Readonly<typeof globalResources> = Object.freeze({
  ...globalResources,
});
/**
 * Built-in lifecycle events emitted by the runtime.
 */
export const events: Readonly<typeof globalEvents> = Object.freeze({
  ...globalEvents,
});
/**
 * Built-in middleware factories grouped by target surface.
 */
export const middleware: Readonly<typeof globalMiddlewares> = Object.freeze({
  ...globalMiddlewares,
});
/**
 * Built-in tags used by core Runner features and routing policies.
 */
export const tags: Readonly<typeof globalTags> = Object.freeze({
  ...globalTags,
});
/**
 * Debug level helpers for configuring runtime observability.
 */
export const debug: Readonly<{ levels: typeof globalDebug.levels }> =
  Object.freeze({ levels: globalDebug.levels });

export {
  defineTask,
  defineResource,
  defineEvent,
  defineEventLane,
  defineRpcLane,
  defineTaskMiddleware,
  defineResourceMiddleware,
  defineAsyncContext,
  defineTag,
  defineOverride,
  defineHook,
  isTask,
  isResource,
  isResourceWithConfig,
  isEvent,
  isEventLane,
  isRpcLane,
  isHook,
  isTaskMiddleware,
  isResourceMiddleware,
  isTag,
  isTagStartup,
  isOptional,
  isError,
  isAsyncContext,
  isOverrideDefinition,
  isSubtreeFilter,
  isIsolationScope,
  run,
  onAnyOf,
  isOneOf,
  isSameDefinition,
  subtreeOfFn as subtreeOf,
  scopeFn as scope,
  asyncContexts,
};

/**
 * The unified fluent builder namespace for creating Runner components.
 *
 * @example
 * ```ts
 * import { r, run } from "@bluelibs/runner";
 *
 * const greet = r.task("app.tasks.greet")
 *   .inputSchema<{ name: string }>({ parse: (v) => v })
 *   .run(async (input) => `Hello, ${input.name}!`)
 *   .build();
 *
 * const app = r.resource("app").register([greet]).build();
 * const runtime = await run(app);
 * const msg = await runtime.runTask(greet, { name: "Ada" });
 * await runtime.dispose();
 * ```
 */
export const r = Object.freeze({
  resource: resourceFn,
  task: taskFn,
  event: eventFn,
  eventLane: eventLaneFn,
  rpcLane: rpcLaneFn,
  hook: hookFn,
  tag: tagFn,
  override: overrideBuilder,
  asyncContext: asyncContextFn,
  error: errorFn,
  subtreeOf: subtreeOfFn,
  scope: scopeFn,
  isSameDefinition,
  middleware: Object.freeze({
    task: taskMiddlewareFn,
    resource: resourceMiddlewareFn,
  }),
});

/**
 * Low-level definition and brand types for advanced integration work.
 */
export * as definitions from "./defs";

// Re-export public models — internal-only classes (DependencyProcessor,
// ResourceInitializer) are excluded from the barrel.
export * from "./models";
export * from "./globals/types";
/**
 * Built-in Runner error helpers keyed by framework error id.
 */
export * as errors from "./errors";
/**
 * Legacy alias for {@link errors}.
 */
export * as Errors from "./errors";
/**
 * Signals cooperative cancellation inside Runner-controlled executions.
 */
export { cancellationError } from "./errors";
/**
 * Platform abstraction and override hook used by advanced integrations and tests.
 */
export { PlatformAdapter, setPlatform } from "./platform";
/**
 * Concrete error class produced by Runner error helpers.
 */
export { RunnerError } from "./definers/defineError";
/**
 * Small mutable map that can be locked once a composition surface should stop changing.
 */
export { LockableMap } from "./tools/LockableMap";
/**
 * Validation and pattern-matching toolkit used by schema-aware Runner APIs.
 */
export { Match, check } from "./tools/check";
export type {
  CheckSchemaLike,
  CheckedValue,
  InferCheckSchema,
  InferMatchPattern,
  MatchCompiledSchema,
  MatchMessageContext,
  MatchMessageDescriptor,
  MatchMessageOptions,
  MatchJsonObject,
  MatchJsonPrimitive,
  MatchJsonSchema,
  MatchJsonValue,
  MatchPattern,
} from "./tools/check";
export type { InferValidationSchemaInput } from "./types/utilities";

/**
 * Universal HTTP client helpers for talking to exposed Runner tasks and events.
 */
export * from "./http-client";

/**
 * Serialization primitives used by HTTP transport, async context exchange, and custom codecs.
 */
export {
  Serializer,
  SymbolPolicy,
  SymbolPolicyErrorMessage,
} from "./serializer";

/**
 * Per-execution scratchpad for middleware and nested task coordination.
 */
export { journal } from "./models/ExecutionJournal";
