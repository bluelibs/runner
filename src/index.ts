import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
  defineIndex,
} from "./define";
import {
  context as contextUtils,
  createContext,
  use as useContext,
  provide as provideContext,
} from "./context";
import { globalEvents } from "./globalEvents";
import { globalResources } from "./globalResources";
import { run } from "./run";

const globals = {
  events: globalEvents,
  resources: globalResources,
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
  useContext,
  provideContext,
};

export * as definitions from "./defs";
export { Store } from "./models/Store";
export { EventManager } from "./models/EventManager";
export { TaskRunner } from "./models/TaskRunner";
