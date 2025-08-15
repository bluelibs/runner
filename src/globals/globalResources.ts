import { defineResource } from "../define";
import { EventManager } from "../models/EventManager";
import { Logger } from "../models/Logger";
import { Store } from "../models/Store";
import { TaskRunner } from "../models/TaskRunner";
import { cacheResource } from "./middleware/cache.middleware";
import { queueResource } from "./resources/queue.resource";
import { globalTags } from "./globalTags";

const systemTag = globalTags.system;

const store = defineResource({
  id: "globals.resources.store",
  init: async (store: Store) => store,
  meta: {
    title: "Store",
    description:
      "A global store that can be used to store and retrieve tasks, resources, events and middleware",
    tags: [systemTag],
  },
});

export const globalResources = {
  store,
  eventManager: defineResource({
    id: "globals.resources.eventManager",
    init: async (em: EventManager) => em,
    meta: {
      title: "Event Manager",
      description:
        "Manages all events and event listeners. This is meant to be used internally for most use-cases.",
      tags: [systemTag],
    },
  }),
  taskRunner: defineResource({
    id: "globals.resources.taskRunner",
    init: async (runner: TaskRunner) => runner,
    meta: {
      title: "Task Runner",
      description:
        "Manages the execution of tasks and task dependencies. This is meant to be used internally for most use-cases.",
      tags: [systemTag],
    },
  }),
  logger: defineResource({
    id: "globals.resources.logger",
    init: async (logger: Logger) => logger,
    meta: {
      // We skip system tag for logger because it's part of the utility toolkit.
      title: "Logger",
      description:
        "Logs all events and errors. This is meant to be used internally for most use-cases. Emits a globals.log event for each log.",
    },
  }),
  cache: cacheResource,
  queue: queueResource,
};
