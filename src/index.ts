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
import { createContext } from "./context";
import { globalEvents } from "./globals/globalEvents";
import { globalResources } from "./globals/globalResources";
import { globalMiddlewares } from "./globals/globalMiddleware";
import { globalTags } from "./globals/globalTags";
import { run } from "./run";
import { createTestResource } from "./testing";

const globals = {
  events: globalEvents,
  resources: globalResources,
  middleware: globalMiddlewares,
  tags: globalTags,
};

export { globals };
export {
  defineTask as task,
  defineResource as resource,
  defineEvent as event,
  defineTaskMiddleware as taskMiddleware,
  defineResourceMiddleware as resourceMiddleware,
  defineTag as tag,
  defineOverride as override,
  defineHook as hook,
  run,
  createContext,
  createTestResource,
};

// Convenience export for easy API: middleware.task / middleware.resource
export const middleware = {
  task: defineTaskMiddleware,
  resource: defineResourceMiddleware,
};

export * as definitions from "./defs";
export * from "./models";
export * from "./globals/types";
export * as Errors from "./errors";
export { RunOptions } from "./run";
export { Context } from "./context";
