import { defineResource } from "./define";
import { EventManager } from "./models/EventManager";
import { Logger } from "./models/Logger";
import { Store } from "./models/Store";
import { TaskRunner } from "./models/TaskRunner";

const store = defineResource({
  id: "global.store",
  init: async (store: Store) => store,
});

export const globalResources = {
  store,
  eventManager: defineResource({
    id: "global.eventManager",
    init: async (em: EventManager) => em,
    meta: {
      title: "Event Manager",
      description:
        "Manages all events and event listeners. This is meant to be used internally for most use-cases.",
      tags: ["internal"],
    },
  }),
  taskRunner: defineResource({
    id: "global.taskRunner",
    init: async (runner: TaskRunner) => runner,
    meta: {
      title: "Task Runner",
      description:
        "Manages the execution of tasks and task dependencies. This is meant to be used internally for most use-cases.",
      tags: ["internal"],
    },
  }),
  logger: defineResource({
    id: "global.logger",
    init: async (logger: Logger) => logger,
    meta: {
      title: "Logger",
      description:
        "Logs all events and errors. This is meant to be used internally for most use-cases. Emits a global.log event for each log.",
    },
  }),
};
