import { defineResource } from "./define";
import { env } from "./env";
import { EventManager } from "./models/EventManager";
import { Logger } from "./models/Logger";
import { Store } from "./models/Store";
import { TaskRunner } from "./models/TaskRunner";

const store = defineResource({
  id: "global.resources.store",
  init: async (store: Store) => store,
  meta: {
    title: "Store",
    description:
      "A global store that can be used to store and retrieve tasks, resources, events and middleware",
    tags: ["internal"],
  },
});

export const globalResources = {
  store,
  env,
  eventManager: defineResource({
    id: "global.resources.eventManager",
    init: async (em: EventManager) => em,
    meta: {
      title: "Event Manager",
      description:
        "Manages all events and event listeners. This is meant to be used internally for most use-cases.",
      tags: ["internal"],
    },
  }),
  taskRunner: defineResource({
    id: "global.resources.taskRunner",
    init: async (runner: TaskRunner) => runner,
    meta: {
      title: "Task Runner",
      description:
        "Manages the execution of tasks and task dependencies. This is meant to be used internally for most use-cases.",
      tags: ["internal"],
    },
  }),
  logger: defineResource({
    id: "global.resources.logger",
    init: async (logger: Logger) => logger,
    meta: {
      title: "Logger",
      description:
        "Logs all events and errors. This is meant to be used internally for most use-cases. Emits a global.log event for each log.",
    },
  }),
};