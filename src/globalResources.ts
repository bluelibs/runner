import { defineResource } from "./define";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { TaskRunner } from "./TaskRunner";

export const globalResources = {
  store: defineResource<Store>({
    id: "global.store",
    init: async (store) => store,
  }),
  eventManager: defineResource<EventManager>({
    id: "global.eventManager",
    init: async (em) => em,
  }),
  taskRunner: defineResource<TaskRunner>({
    id: "global.taskRunner",
    init: async (runner) => runner,
  }),
};
