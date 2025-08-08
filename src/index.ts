import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
  defineIndex,
  defineTag,
  defineOverride,
} from "./define";
import { createContext } from "./context";
import { globalEvents } from "./globals/globalEvents";
import { globalResources } from "./globals/globalResources";
import { globalMiddlewares } from "./globals/globalMiddleware";
import { run } from "./run";
import { createTestResource } from "./testing";

const globals = {
  events: globalEvents,
  resources: globalResources,
  middlewares: globalMiddlewares,
};

export { globals };
export {
  defineTask as task,
  defineResource as resource,
  defineEvent as event,
  defineMiddleware as middleware,
  defineIndex as index,
  defineTag as tag,
  defineOverride as override,
  run,
  createContext,
  createTestResource,
};

export * as definitions from "./defs";
export { Semaphore, Store, EventManager, TaskRunner, Queue } from "./models";
