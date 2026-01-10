/**
 * @packageDocumentation
 *
 * # BlueLibs Runner
 *
 * A TypeScript-first dependency injection framework that combines functional programming
 * with enterprise features. No decorators, no magic - just explicit, testable code.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { r, run } from "@bluelibs/runner";
 *
 * // Define a task (a function with superpowers)
 * const greet = r.task("greet")
 *   .run(async (name: string) => `Hello, ${name}!`)
 *   .build();
 *
 * // Create and run your app
 * const app = r.resource("app").register([greet]).build();
 * const { runTask } = await run(app);
 *
 * console.log(await runTask(greet, "World")); // "Hello, World!"
 * ```
 *
 * ## Core Concepts
 *
 * - **Tasks**: Functions with dependency injection, middleware, and validation
 * - **Resources**: Singleton services with lifecycle management (init/dispose)
 * - **Events**: Type-safe messages for decoupled communication
 * - **Hooks**: Lightweight event handlers
 * - **Middleware**: Cross-cutting concerns (auth, logging, caching)
 *
 * ## Learn More
 *
 * - [Documentation](https://github.com/bluelibs/runner/blob/main/README.md)
 * - [Examples](https://github.com/bluelibs/runner/tree/main/examples)
 * - [API Reference](https://bluelibs.github.io/runner/)
 *
 * @module @bluelibs/runner
 */

import {
  defineTask,
  defineResource,
  defineEvent,
  defineTaskMiddleware,
  defineResourceMiddleware,
  defineTag,
  defineOverride,
  defineHook,
} from "./define";
import {
  defineAsyncContext,
  createContext as oldCreateContext,
} from "./definers/defineAsyncContext";
import { globalEvents } from "./globals/globalEvents";
import { globalResources } from "./globals/globalResources";
import { globalMiddlewares } from "./globals/globalMiddleware";
import { globalTags } from "./globals/globalTags";
import { debug } from "./globals/debug";
import { run } from "./run";
import { tunnels } from "./globals/tunnels";
import { createTestResource } from "./testing";
import { resource as resourceFn } from "./definers/builders/resource";
import { task as taskFn } from "./definers/builders/task";
import { event as eventFn } from "./definers/builders/event";
import { hook as hookFn } from "./definers/builders/hook";
import {
  taskMiddleware as taskMiddlewareFn,
  resourceMiddleware as resourceMiddlewareFn,
} from "./definers/builders/middleware";
import { tag as tagFn } from "./definers/builders/tag";
import { error as errorFn } from "./definers/builders/error";
import { asyncContext as asyncContextFn } from "./definers/builders/asyncContext";

const globals = {
  events: globalEvents,
  resources: globalResources,
  middleware: globalMiddlewares,
  tags: globalTags,
  tunnels,
  debug,
};

export { globals };
export {
  defineTask as task,
  defineResource as resource,
  defineEvent as event,
  defineTaskMiddleware as taskMiddleware,
  defineResourceMiddleware as resourceMiddleware,
  defineAsyncContext as asyncContext,
  defineTag as tag,
  defineOverride as override,
  defineHook as hook,
  run,
  createTestResource,
};

// Legacy alias accepted in tests; with optional id support
const createContext = oldCreateContext;
export { createContext };

// Expose only a single namespace `r` that contains all builder entry points
export const r = Object.freeze({
  resource: resourceFn,
  task: taskFn,
  event: eventFn,
  hook: hookFn,
  tag: tagFn,
  asyncContext: asyncContextFn,
  error: errorFn,
  middleware: Object.freeze({
    task: taskMiddlewareFn,
    resource: resourceMiddlewareFn,
  }),
});

export * as definitions from "./defs";
export * from "./models";
export * from "./globals/types";
export * as Errors from "./errors";
export { PlatformAdapter, setPlatform } from "./platform";

// HTTP and tunnel functionality
export * from "./http-client";
export * from "./http-fetch-tunnel.resource";

// Re-export types at the package root so consumer declaration emits can reference them directly
export type * from "./defs";

export { Serializer, getDefaultSerializer } from "./serializer";
export type { TypeDefinition, SerializerOptions } from "./serializer";
