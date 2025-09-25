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
export { EJSON } from "@bluelibs/ejson";

// Re-export types at the package root so consumer declaration emits can reference them directly
export type * from "./defs";
