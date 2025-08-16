import { defineEvent } from "../define";
import { IEvent, IResource } from "../defs";
import { ILog } from "../models/Logger";
import { globalTags } from "./globalTags";

const systemTag = globalTags.system;

export const globalEvents = {
  // Minimal core events retained if any (custom events can still be defined by users)
  /**
   * Emitted when the system is fully initialized and ready for work.
   */
  ready: defineEvent<{
    root: IResource<any, any, any, any>;
  }>({
    id: "global.ready",
    meta: {
      title: "System Ready",
      description:
        "Emitted when the system has completed boot and is ready for listeners to start work." +
        "This runs right before returning value for run().",
      tags: [systemTag],
    },
  }),
  /**
   * Emitted right before a hook's run executes.
   */
  hookTriggered: defineEvent<{
    hookId: string;
    eventId: string;
  }>({
    id: "global.events.hookTriggered",
    meta: {
      title: "Hook Triggered",
      description:
        "Emitted immediately before a hook starts running for an event.",
      tags: [systemTag, globalTags.excludeFromGlobalListeners],
    },
  }),
  /**
   * Emitted after a hook completes (success or failure). Contains optional error.
   */
  hookCompleted: defineEvent<{
    hookId: string;
    eventId: string;
    error?: Error;
  }>({
    id: "global.events.hookCompleted",
    meta: {
      title: "Hook Completed",
      description: "Emitted after a hook finishes running for an event.",
      tags: [systemTag, globalTags.excludeFromGlobalListeners],
    },
  }),
  /**
   * Central error boundary event for any thrown error across the runner.
   */
  unhandledError: defineEvent<{
    kind: "task" | "middleware" | "resourceInit" | "hook" | "process";
    id?: string;
    source?: string;
    note?: string;
    error: any;
  }>({
    id: "global.events.unhandledError",
    meta: {
      title: "Unhandled Error",
      description:
        "Central error boundary event for any thrown error across the runner.",
      tags: [systemTag, globalTags.excludeFromGlobalListeners],
    },
  }),
} as const;

export const globalEventsArray: IEvent<any>[] = [
  globalEvents.ready,
  globalEvents.hookTriggered,
  globalEvents.hookCompleted,
  globalEvents.unhandledError,
];
