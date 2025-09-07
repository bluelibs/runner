import { defineEvent } from "../define";
import {
  IEvent,
  IResource,
  IHook,
  ITaskMiddleware,
  IResourceMiddleware,
} from "../defs";
import { globalTags } from "./globalTags";

const systemTag = globalTags.system;

export const globalEvents = {
  // Minimal core events retained if any (custom events can still be defined by users)
  /**
   * Emitted when the system is fully initialized and ready for work.
   */
  ready: defineEvent<{
    root: IResource<any, any, any, any, any, any, any>;
  }>({
    id: "globals.events.ready",
    meta: {
      title: "System Ready",
      description:
        "Emitted when the system has completed boot and is ready for listeners to start work." +
        "This runs right before returning value for run().",
    },
  }),
} as const;

export const globalEventsArray: IEvent<any>[] = [globalEvents.ready];
