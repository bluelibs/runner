import { defineEvent } from "../define";
import {
  ITask,
  IResource,
  IEvent,
  MiddlewareBeforeRunEventPayload,
  OnErrorEventPayload,
  MiddlewareAfterRunEventPayload,
  IMiddleware,
  MiddlewareInputMaybeTaskOrResource,
} from "../defs";
import { ILog } from "../models/Logger";
import { globalTags } from "./globalTags";

const systemTag = globalTags.system;

export const globalEvents = {
  beforeInit: defineEvent({
    id: "globals.events.beforeInit",
    meta: {
      title: "Before Initialization",
      description:
        "Triggered before any resource or system-wide initialization occurs.",
      tags: [systemTag],
    },
  }),
  afterInit: defineEvent({
    id: "globals.events.afterInit",
    meta: {
      title: "After Initialization",
      description:
        "Fired after the system or resource initialization is completed.",
      tags: [systemTag],
    },
  }),
  tasks: {
    beforeRun: defineEvent<{
      task: ITask<any, any, any>;
      input: any;
    }>({
      id: "globals.events.tasks.beforeRun",
      meta: {
        title: "Before Task Execution",
        description:
          "Triggered before a task starts running, providing access to the input data.",
        tags: [systemTag],
      },
    }),
    afterRun: defineEvent<{
      task: ITask<any, any, any>;
      input: any;
      output: any;
      setOutput: (newOutput: any) => void;
    }>({
      id: "globals.events.tasks.afterRun",
      meta: {
        title: "After Task Execution",
        description:
          "Fired after a task has completed, providing both the input and output data.",
        tags: [systemTag],
      },
    }),
    onError: defineEvent<{
      error: any;
      suppress: () => void;
      task: ITask<any, any, any>;
    }>({
      id: "globals.events.tasks.onError",
      meta: {
        title: "Task Error",
        description:
          "Triggered when an error occurs during task execution. Allows error suppression.",
        tags: [systemTag],
      },
    }),
  },
  resources: {
    beforeInit: defineEvent<{
      resource: IResource<any, any, any>;
      config: any;
    }>({
      id: "globals.events.resources.beforeInit",
      meta: {
        title: "Before Resource Initialization",
        description:
          "Fired before a resource is initialized, with access to the configuration.",
        tags: [systemTag],
      },
    }),
    afterInit: defineEvent<{
      resource: IResource<any, any, any>;
      config: any;
      value: any;
    }>({
      id: "globals.events.resources.afterInit",
      meta: {
        title: "After Resource Initialization",
        description:
          "Fired after a resource has been initialized, providing the final value.",
        tags: [systemTag],
      },
    }),
    onError: defineEvent<{
      error: Error;
      suppress: () => void;
      resource: IResource<any, any, any>;
    }>({
      id: "globals.events.resources.onError",
      meta: {
        title: "Resource Error",
        description:
          "Triggered when an error occurs during resource initialization. Allows error suppression.",
        tags: [systemTag],
      },
    }),
  },
  middlewares: {
    beforeRun: defineEvent<
      MiddlewareBeforeRunEventPayload & {
        middleware: IMiddleware;
      }
    >({
      id: "globals.events.middleware.beforeRun",
      meta: {
        title: "Before Middleware Run",
        description: "Triggered before a middleware runs.",
        tags: [systemTag],
      },
    }),
    afterRun: defineEvent<
      MiddlewareAfterRunEventPayload & {
        middleware: IMiddleware;
      } & MiddlewareInputMaybeTaskOrResource
    >({
      id: "globals.events.middleware.afterRun",
      meta: {
        title: "After Middleware Run",
        description: "Triggered after a middleware runs.",
        tags: [systemTag],
      },
    }),
    onError: defineEvent<
      OnErrorEventPayload & {
        middleware: IMiddleware;
      } & MiddlewareInputMaybeTaskOrResource
    >({
      id: "globals.events.middleware.onError",
      meta: {
        title: "Middleware Error",
        description:
          "Triggered when an error occurs during middleware execution. Allows error suppression.",
        tags: [systemTag],
      },
    }),
  },
};

export const globalEventsArray = [
  globalEvents.beforeInit,
  globalEvents.afterInit,
  globalEvents.tasks.beforeRun,
  globalEvents.tasks.afterRun,
  globalEvents.tasks.onError,
  globalEvents.resources.beforeInit,
  globalEvents.resources.afterInit,
  globalEvents.resources.onError,
  globalEvents.middlewares.beforeRun,
  globalEvents.middlewares.afterRun,
  globalEvents.middlewares.onError,
];
