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
   * Emitted right before a middleware's run executes (for tasks/resources).
   */
  middlewareTriggered: defineEvent<{
    kind: "task" | "resource";
    middlewareId: string;
    targetId: string;
  }>({
    id: "global.events.middlewareTriggered",
    meta: {
      title: "Middleware Triggered",
      description:
        "Emitted immediately before a middleware starts running for a task or resource.",
      tags: [systemTag, globalTags.excludeFromGlobalListeners],
    },
  }),
  /**
   * Emitted after a middleware completes (success or failure). Contains optional error.
   */
  middlewareCompleted: defineEvent<{
    kind: "task" | "resource";
    middlewareId: string;
    targetId: string;
    error?: Error;
  }>({
    id: "global.events.middlewareCompleted",
    meta: {
      title: "Middleware Completed",
      description:
        "Emitted after a middleware finishes running for a task or resource.",
      tags: [systemTag, globalTags.excludeFromGlobalListeners],
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
    /**
     * Where it happened, which element id triggered this issue.
     */
    source?: string;
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
  globalEvents.middlewareTriggered,
  globalEvents.middlewareCompleted,
];
