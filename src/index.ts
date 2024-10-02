import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
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
  run,
};

export * as definitions from "./defs";
export { Store } from "./Store";
export { EventManager } from "./EventManager";
export { TaskRunner } from "./TaskRunner";
