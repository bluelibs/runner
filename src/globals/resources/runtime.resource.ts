import { defineResource } from "../../define";
import type {
  DependencyMapType,
  IEvent,
  IEventEmitOptions,
  IEventEmitReport,
  IResource,
  ITask,
} from "../../defs";
import { globalTags } from "../globalTags";
import type { EventManager } from "../../models/EventManager";
import type { Store } from "../../models/Store";
import type { TaskRunner } from "../../models/TaskRunner";

export interface RuntimeServices {
  runTask: <
    I = undefined,
    O extends Promise<any> = any,
    D extends DependencyMapType = DependencyMapType,
  >(
    task: ITask<I, O, D> | string,
    ...args: I extends undefined | void ? [] : [I]
  ) => Promise<O | undefined>;

  emitEvent: {
    <P>(
      event: IEvent<P> | string,
      payload?: P extends undefined | void ? undefined : P,
    ): Promise<void>;
    <P>(
      event: IEvent<P> | string,
      payload: P extends undefined | void ? undefined : P,
      options: IEventEmitOptions & { report: true },
    ): Promise<IEventEmitReport>;
    <P>(
      event: IEvent<P> | string,
      payload?: P extends undefined | void ? undefined : P,
      options?: IEventEmitOptions,
    ): Promise<void | IEventEmitReport>;
  };

  getResourceValue: <Output extends Promise<any>>(
    resource: string | IResource<any, Output, any, any, any>,
  ) => Output extends Promise<infer U> ? U : Output;

  getResourceConfig: <Config>(
    resource: string | IResource<Config, any, any, any, any>,
  ) => Config;

  getRootId: () => string;
  getRootConfig: <Config = unknown>() => Config;
  getRootValue: <Value = unknown>() => Value;
}

interface RuntimeFactoryArgs {
  store: Store;
  eventManager: EventManager;
  taskRunner: TaskRunner;
}

export function createRuntimeServices({
  store,
  eventManager,
  taskRunner,
}: RuntimeFactoryArgs): RuntimeServices {
  const getRootOrThrow = () => {
    if (!store.root) {
      throw new Error("Root resource is not available.");
    }

    return store.root;
  };

  const getResourceId = (
    resource: string | IResource<any, any, any, any, any>,
  ): string => (typeof resource === "string" ? resource : resource.id);

  return {
    runTask: <
      I = undefined,
      O extends Promise<any> = any,
      D extends DependencyMapType = DependencyMapType,
    >(
      task: ITask<I, O, D> | string,
      ...args: I extends undefined | void ? [] : [I]
    ) => {
      if (typeof task === "string") {
        const taskId = task;
        if (!store.tasks.has(taskId)) {
          throw new Error(`Task "${taskId}" not found.`);
        }
        task = store.tasks.get(taskId)!.task;
      }

      return taskRunner.run(task, ...args);
    },

    emitEvent: (<P>(
      event: IEvent<P> | string,
      payload?: P extends undefined | void ? undefined : P,
      options?: IEventEmitOptions,
    ) => {
      if (typeof event === "string") {
        const eventId = event;
        if (!store.events.has(eventId)) {
          throw new Error(`Event "${eventId}" not found.`);
        }
        event = store.events.get(eventId)!.event;
      }

      return eventManager.emit(event, payload, "outside", options);
    }) as RuntimeServices["emitEvent"],

    getResourceValue: <Output extends Promise<any>>(
      resource: string | IResource<any, Output, any, any, any>,
    ): Output extends Promise<infer U> ? U : Output => {
      const resourceId = getResourceId(resource);
      const storeResource = store.resources.get(resourceId);
      if (!storeResource) {
        throw new Error(`Resource "${resourceId}" not found.`);
      }
      if (storeResource.isInitialized !== true) {
        throw new Error(`Resource "${resourceId}" is not initialized yet.`);
      }

      return storeResource.value;
    },

    getResourceConfig: <Config>(
      resource: string | IResource<Config, any, any, any, any>,
    ): Config => {
      const resourceId = getResourceId(resource);
      const storeResource = store.resources.get(resourceId);
      if (!storeResource) {
        throw new Error(`Resource "${resourceId}" not found.`);
      }

      return storeResource.config;
    },

    getRootId: (): string => getRootOrThrow().resource.id,

    getRootConfig: <Config = unknown>(): Config =>
      getRootOrThrow().config as Config,

    getRootValue: <Value = unknown>(): Value => {
      const root = getRootOrThrow();
      if (root.isInitialized !== true) {
        throw new Error(
          `Root resource "${root.resource.id}" is not initialized yet.`,
        );
      }

      return root.value as Value;
    },
  };
}

const systemTag = globalTags.system;

export const runtimeResource = defineResource<void, Promise<RuntimeServices>>({
  id: "globals.resources.runtime",
  meta: {
    title: "Runtime Services",
    description:
      "Safe runtime facade for advanced in-resource operations (task/event execution, resource reads, root helpers).",
  },
  tags: [systemTag],
});
