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
<<<<<<< HEAD
import { globalTags } from "./globals/globalTags";
=======
import { globalTasks } from "./globals/globalTasks";
>>>>>>> 787204c (Implement complete authentication system with middleware and JWT support)
import { run } from "./run";
import { createTestResource } from "./testing";

const globals = {
  events: globalEvents,
  resources: globalResources,
<<<<<<< HEAD
  middleware: globalMiddlewares,
  tags: globalTags,
=======
  middlewares: globalMiddlewares,
  tasks: globalTasks,
>>>>>>> 787204c (Implement complete authentication system with middleware and JWT support)
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

export * as definitions from "./defs";
export * from "./models";
export * from "./globals/types";
export * as Errors from "./errors";
export { Context } from "./context";
