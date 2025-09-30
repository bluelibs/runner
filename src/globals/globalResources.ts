import { defineResource } from "../define";
import { EventManager } from "../models/EventManager";
import { Logger } from "../models/Logger";
import { Store } from "../models/Store";
import { TaskRunner } from "../models/TaskRunner";
import { cacheResource } from "./middleware/cache.middleware";
import { queueResource } from "./resources/queue.resource";
import { globalTags } from "./globalTags";
import { MiddlewareManager } from "../models/MiddlewareManager";
import type { Serializer } from "./resources/tunnel/serializer";
import { httpClientFactory } from "./resources/httpClientFactory.resource";

const systemTag = globalTags.system;

export const store = defineResource<void, Promise<Store>>({
  id: "globals.resources.store",
  meta: {
    title: "Store",
    description:
      "A global store that can be used to store and retrieve tasks, resources, events and middleware",
  },
  tags: [systemTag],
});

export const serializer = defineResource<void, Promise<Serializer>>({
  id: "globals.resources.serializer",
  meta: {
    title: "Serializer",
    description:
      "Serializes and deserializes data. Provides EJSON-compatible stringify/parse and custom type registration via addType.",
  },
  tags: [systemTag],
});

export const globalResources = {
  store,
  middlewareManager: defineResource<void, Promise<MiddlewareManager>>({
    id: "globals.resources.middlewareManager",
    meta: {
      title: "Middleware Manager",
      description: "Manages all middleware and middleware interceptors.",
    },
    tags: [systemTag],
  }),
  eventManager: defineResource<void, Promise<EventManager>>({
    id: "globals.resources.eventManager",
    meta: {
      title: "Event Manager",
      description:
        "Manages all events and event listeners. This is meant to be used internally for most use-cases.",
    },
    tags: [systemTag],
  }),
  taskRunner: defineResource<void, Promise<TaskRunner>>({
    id: "globals.resources.taskRunner",
    meta: {
      title: "Task Runner",
      description:
        "Manages the execution of tasks and task dependencies. This is meant to be used internally for most use-cases.",
    },
    tags: [systemTag],
  }),
  logger: defineResource<void, Promise<Logger>>({
    id: "globals.resources.logger",
    meta: {
      // We skip system tag for logger because it's part of the utility toolkit.
      title: "Logger",
      description:
        "Logs all events and errors. This is meant to be used internally for most use-cases. Emits a globals.log event for each log.",
    },
    tags: [systemTag],
  }),
  serializer,
  cache: cacheResource,
  queue: queueResource,
  httpClientFactory: httpClientFactory,
} as const;
