import { defineEvent } from "../define";
import { IEvent, IResource, IHook, IMiddleware } from "../defs";
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
      tags: [], // Intentionally left no system tag. Because this is an 'interest' event.
    },
  }),
  /**
   * Emitted right before a middleware's run executes (for tasks/resources).
   */
  middlewareTriggered: defineEvent<{
    kind: "task" | "resource";
    middleware: IMiddleware<any, any>;
    targetId: string;
  }>({
    id: "global.events.middlewareTriggered",
    meta: {
      title: "Middleware Triggered",
      description:
        "Emitted immediately before a middleware starts running for a task or resource.",
      tags: [systemTag, globalTags.excludeFromGlobalHooks],
    },
  }),
  /**
   * Emitted after a middleware completes (success or failure). Contains optional error.
   */
  middlewareCompleted: defineEvent<{
    kind: "task" | "resource";
    middleware: IMiddleware<any, any>;
    targetId: string;
    error?: Error;
  }>({
    id: "global.events.middlewareCompleted",
    meta: {
      title: "Middleware Completed",
      description:
        "Emitted after a middleware finishes running for a task or resource.",
      tags: [systemTag, globalTags.excludeFromGlobalHooks],
    },
  }),
  /**
   * Emitted right before a hook's run executes.
   */
  hookTriggered: defineEvent<{
    hook: IHook<any, any>;
    eventId: string;
  }>({
    id: "global.events.hookTriggered",
    meta: {
      title: "Hook Triggered",
      description:
        "Emitted immediately before a hook starts running for an event.",
      tags: [systemTag, globalTags.excludeFromGlobalHooks],
    },
  }),
  /**
   * Emitted after a hook completes (success or failure). Contains optional error.
   */
  hookCompleted: defineEvent<{
    hook: IHook<any, any>;
    eventId: string;
    error?: Error;
  }>({
    id: "global.events.hookCompleted",
    meta: {
      title: "Hook Completed",
      description: "Emitted after a hook finishes running for an event.",
      tags: [systemTag, globalTags.excludeFromGlobalHooks],
    },
  }),
  /**
   * Central error boundary event for any thrown error across the runner.
   */
  unhandledError: defineEvent<{
    kind: "task" | "middleware" | "resourceInit" | "hook" | "process" | "run";
    error: any;
  }>({
    id: "global.events.unhandledError",
    meta: {
      title: "Unhandled Error",
      description:
        "Central error boundary event for any thrown error across the runner.",
      tags: [systemTag, globalTags.excludeFromGlobalHooks],
    },
  }),
} as const;

export const globalEventsArray: IEvent<any>[] = [
  globalEvents.ready,
  globalEvents.hookTriggered,
  globalEvents.hookCompleted,
  globalEvents.middlewareTriggered,
  globalEvents.middlewareCompleted,
];
