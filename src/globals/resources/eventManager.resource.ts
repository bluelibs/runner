import { defineResource } from "../../define";
import type { EventManager } from "../../models/EventManager";
import { globalTags } from "../globalTags";

export const eventManagerResource = defineResource<void, Promise<EventManager>>(
  {
    id: "globals.resources.eventManager",
    meta: {
      title: "Event Manager",
      description:
        "Manages all events and event listeners. This is meant to be used internally for most use-cases.",
    },
    tags: [globalTags.system],
    dispose: async (eventManager) => {
      eventManager.dispose();
    },
  },
);
