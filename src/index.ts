import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
  defineIndex,
} from "./define";
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
};

export * as definitions from "./defs";
export { Store } from "./models/Store";
export { EventManager } from "./models/EventManager";
export { TaskRunner } from "./models/TaskRunner";
