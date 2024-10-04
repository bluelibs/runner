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
  }),
  taskRunner: defineResource({
    id: "global.taskRunner",
    init: async (runner: TaskRunner) => runner,
  }),
  logger: defineResource({
    id: "global.logger",
    init: async (logger: Logger) => logger,
  }),
};
