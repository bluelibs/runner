import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
  defineIndex,
} from "./define";
import { createContext } from "./context";
import { globalEvents } from "./globals/globalEvents";
import { globalResources } from "./globals/globalResources";
import { globalMiddlewares } from "./globals/globalMiddleware";
import { run } from "./run";

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
  run,
  createContext,
};

export * as definitions from "./defs";
export { Semaphore, Store, EventManager, TaskRunner, Queue } from "./models";
