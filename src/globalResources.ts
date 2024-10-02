import { defineResource } from "./define";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { TaskRunner } from "./TaskRunner";

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
};
