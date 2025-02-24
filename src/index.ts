import {
  defineTask,
  defineResource,
  defineEvent,
  defineMiddleware,
} from "./define";
import { env, EnvVars } from "./env";
import { globalEvents } from "./globalEvents";
import { globalResources } from "./globalResources";
import { run } from "./run";

const globals = {
  events: globalEvents,
  resources: globalResources,
};

export { globals, env, EnvVars };
export {
  defineTask as task,
  defineResource as resource,
  defineEvent as event,
  defineMiddleware as middleware,
  run,
};

export * as definitions from "./defs";
export { Store } from "./models/Store";
export { EventManager } from "./models/EventManager";
export { TaskRunner } from "./models/TaskRunner";
export { EnvironmentManager } from "./models/EnvironmentManager";