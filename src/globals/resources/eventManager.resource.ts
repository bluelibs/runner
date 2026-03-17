import { defineResource } from "../../definers/defineResource";
import type { EventManager } from "../../models/EventManager";

export const eventManagerResource = defineResource<void, Promise<EventManager>>(
  {
    id: "eventManager",
    meta: {
      title: "Event Manager",
      description:
        "Manages all events and event listeners. This is meant to be used internally for most use-cases.",
    },
    dispose: async (eventManager) => {
      eventManager.dispose();
    },
  },
);
