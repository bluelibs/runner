import {
  defineTask,
  defineResource,
  defineEvent,
  defineEventLane,
  defineRpcLane,
  defineTaskMiddleware,
  defineResourceMiddleware,
  defineTag,
  defineHook,
} from "./define";
import {
  defineAsyncContext,
  createContext as oldCreateContext,
} from "./definers/defineAsyncContext";
import { globalEvents } from "./globals/globalEvents";
import {
  globalResources,
  runnerResources,
  systemResources,
} from "./globals/globalResources";
import { globalMiddlewares } from "./globals/globalMiddleware";
import { globalTags } from "./globals/globalTags";
import { debug } from "./globals/debug";
import { run } from "./run";
import { createTestResource } from "./testing";
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

const rSystem = Object.freeze({
  ...systemResources,
  events: globalEvents,
  tags: Object.freeze({
    system: globalTags.system,
    internal: globalTags.internal,
  }),
});

const rRunner = Object.freeze({
  ...runnerResources,
  middleware: globalMiddlewares,
  tags: globalTags,
});

const rDebug = Object.freeze({
  levels: debug.levels,
});

/**
 * @deprecated Use `r.system`, `r.runner`, and `r.debug` instead.
 * Kept as a compatibility alias and scheduled for removal in the next major version.
 */
export const globals = {
  events: globalEvents,
  resources: globalResources,
  system: rSystem,
  runner: rRunner,
  middleware: globalMiddlewares,
  /** @deprecated Use `middleware` namespace. Kept for backward compatibility. */
  middlewares: globalMiddlewares,
  tags: globalTags,
  debug: rDebug,
};

export const system = rSystem;
export const runner = rRunner;
export {
  defineTask as task,
  defineResource as resource,
  defineEvent as event,
  defineEventLane as eventLane,
  defineRpcLane as rpcLane,
  defineTaskMiddleware as taskMiddleware,
  defineResourceMiddleware as resourceMiddleware,
  defineAsyncContext as asyncContext,
  defineTag as tag,
  overrideBuilder as override,
  defineHook as hook,
  run,
  createTestResource,
  onAnyOf,
  isOneOf,
};

// Legacy alias kept for compatibility.
const createContext = oldCreateContext;
export { createContext };

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
  middleware: Object.freeze({
    task: taskMiddlewareFn,
    resource: resourceMiddlewareFn,
  }),
  system: rSystem,
  runner: rRunner,
  debug: rDebug,
});

export * as definitions from "./defs";

// Re-export public models — internal-only classes (DependencyProcessor,
// ResourceInitializer) are excluded from the barrel.
export * from "./models";
export * from "./globals/types";
export * as Errors from "./errors";
export { cancellationError } from "./errors";
export { PlatformAdapter, setPlatform } from "./platform";
export { RunnerError } from "./definers/defineError";
export { LockableMap } from "./tools/LockableMap";
export { Match, check } from "./tools/check";
export type {
  CheckSchemaLike,
  CheckedValue,
  InferCheckSchema,
  InferMatchPattern,
  MatchCompiledSchema,
  MatchJsonObject,
  MatchJsonPrimitive,
  MatchJsonSchema,
  MatchJsonValue,
  MatchPattern,
} from "./tools/check";

// HTTP transport functionality
export * from "./http-client";

export {
  Serializer,
  SymbolPolicy,
  SymbolPolicyErrorMessage,
} from "./serializer";

// ExecutionJournal for per-execution state sharing
export { journal } from "./models/ExecutionJournal";
