/**
 * Factory functions for defining tasks, resources, events and middleware.
 *
 * These helpers create strongly-typed definitions while also wiring internal
 * metadata: anonymous IDs, file path tags (for better debugging), lifecycle
 * events, and global middleware flags. See README for high-level concepts.
 */
import {
  ITask,
  ITaskDefinition,
  IResource,
  IResourceWithConfig,
  IResourceDefinition,
  IEventDefinition,
  IMiddlewareDefinition,
  symbols,
  DependencyMapType,
  DependencyValuesType,
  IMiddleware,
  IEvent,
  symbolEvent,
  RegisterableItems,
  symbolMiddlewareConfigured,
  symbolFilePath,
  symbolIndexResource,
} from "./defs";
import { Errors } from "./errors";
import { generateCallerIdFromFile, getCallerFile } from "./tools/getCallerFile";

// Helper function to get the caller file

export function defineTask<
  Input = undefined,
  Output extends Promise<any> = any,
  Deps extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition | undefined = undefined
>(
  taskConfig: ITaskDefinition<Input, Output, Deps, TOn>
): ITask<Input, Output, Deps, TOn> {
  /**
   * Creates a task definition.
   * - Generates an anonymous id based on file path when `id` is omitted
   * - Wires lifecycle events: beforeRun, afterRun, onError
   * - Carries through dependencies and middleware as declared
   */
  const filePath = getCallerFile();
  const isAnonymous = !Boolean(taskConfig.id);
  const id = taskConfig.id || generateCallerIdFromFile(filePath, "task");
  return {
    [symbols.task]: true,
    [symbols.filePath]: filePath,
    id,
    dependencies: taskConfig.dependencies || ({} as Deps),
    middleware: taskConfig.middleware || [],
    run: taskConfig.run,
    on: taskConfig.on,
    listenerOrder: taskConfig.listenerOrder,
    events: {
      beforeRun: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-task.events.beforeRun`)
            : `${id as string}.events.beforeRun`,
        }),
        [symbols.filePath]: getCallerFile(),
      },
      afterRun: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-task.events.afterRun`)
            : `${id as string}.events.afterRun`,
        }),
        [symbols.filePath]: getCallerFile(),
      },
      onError: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-task.events.onError`)
            : `${id as string}.events.onError`,
        }),
        [symbols.filePath]: getCallerFile(),
      },
    },
    meta: taskConfig.meta || {},
    // autorun,
  };
}

export function defineResource<
  TConfig = void,
  TValue = any,
  TDeps extends DependencyMapType = {},
  TPrivate = any
>(
  constConfig: IResourceDefinition<TConfig, TValue, TDeps, TPrivate>
): IResource<TConfig, TValue, TDeps, TPrivate> {
  /**
   * Creates a resource definition.
   * - Generates anonymous id when omitted (resource or index flavor)
   * - Wires lifecycle events: beforeInit, afterInit, onError
   * - Exposes `.with(config)` for config‑bound registration
   */
  // The symbolFilePath might already come from defineIndex() for example
  const filePath: string = constConfig[symbolFilePath] || getCallerFile();
  const isIndexResource = constConfig[symbolIndexResource] || false;
  const isAnonymous = !Boolean(constConfig.id);
  const id =
    constConfig.id ||
    generateCallerIdFromFile(filePath, isIndexResource ? "index" : "resource");
  return {
    [symbols.resource]: true,
    [symbols.filePath]: filePath,
    id,
    dependencies: constConfig.dependencies,
    dispose: constConfig.dispose,
    register: constConfig.register || [],
    overrides: constConfig.overrides || [],
    init: constConfig.init,
    context: constConfig.context,
    with: function (config: TConfig) {
      return {
        [symbols.resourceWithConfig]: true,
        id: this.id,
        resource: this,
        config,
      };
    },

    events: {
      beforeInit: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-resource.events.beforeInit`)
            : `${id as string}.events.beforeInit`,
        }),
        [symbols.filePath]: filePath,
      },
      afterInit: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-resource.events.afterInit`)
            : `${id as string}.events.afterInit`,
        }),
        [symbols.filePath]: filePath,
      },
      onError: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-resource.events.onError`)
            : `${id as string}.events.onError`,
        }),
        [symbols.filePath]: filePath,
      },
    },
    meta: constConfig.meta || {},
    middleware: constConfig.middleware || [],
  };
}

/**
 * Creates an "index" resource which groups multiple registerable items under
 * a single dependency. The resulting resource registers every item, depends
 * on the same items, and returns the resolved dependency map so users can
 * access them naturally: `deps.services.myTask()` or `deps.services.myResource`.
 */
export function defineIndex<
  T extends Record<string, RegisterableItems>,
  D extends {
    [K in keyof T]: T[K] extends IResourceWithConfig<any, any, any>
      ? T[K]["resource"]
      : T[K];
  } & DependencyMapType
>(items: T): IResource<void, DependencyValuesType<D>, D> {
  // Build dependency map from given items; unwrap `.with()` to the base resource
  const dependencies = {} as D;
  const register: RegisterableItems[] = [];

  for (const key of Object.keys(items) as (keyof T)[]) {
    const item = items[key];
    register.push(item);

    if (isResourceWithConfig(item)) {
      (dependencies as any)[key] = item.resource;
    } else {
      (dependencies as any)[key] = item as any;
    }
  }
  const callerFilePath = getCallerFile();

  return defineResource({
    register,
    dependencies,
    async init(_, deps) {
      return deps as any;
    },
    [symbols.filePath]: callerFilePath,
    [symbols.indexResource]: true,
  });
}

export function defineEvent<TPayload = void>(
  config?: IEventDefinition<TPayload>
): IEvent<TPayload> {
  /**
   * Creates an event definition. Anonymous ids are generated from file path
   * when omitted. The returned object is branded for runtime checks.
   */
  const callerFilePath = getCallerFile();
  const eventConfig = config || {};
  return {
    ...eventConfig,
    id: eventConfig.id || generateCallerIdFromFile(callerFilePath, "event"),
    [symbols.filePath]: callerFilePath,
    [symbolEvent]: true, // This is a workaround
  };
}

export type MiddlewareEverywhereOptions = {
  /**
   * Enable this for tasks. Default is true.
   */
  tasks?: boolean;
  /**
   * Enable this for resources. Default is true.
   */
  resources?: boolean;
};

export function defineMiddleware<
  TConfig extends Record<string, any>,
  TDependencies extends DependencyMapType
>(
  middlewareDef: IMiddlewareDefinition<TConfig, TDependencies>
): IMiddleware<TConfig, TDependencies> {
  /**
   * Creates a middleware definition with:
   * - Anonymous id generation when omitted
   * - `.with(config)` to create configured instances
   * - `.everywhere()` to mark as global (optionally scoping to tasks/resources)
   */
  const filePath = getCallerFile();
  const object = {
    [symbols.filePath]: filePath,
    [symbols.middleware]: true,
    config: {} as TConfig,
    id: middlewareDef.id || generateCallerIdFromFile(filePath, "middleware"),
    ...middlewareDef,
    dependencies: middlewareDef.dependencies || ({} as TDependencies),
  } as IMiddleware<TConfig, TDependencies>;

  return {
    ...object,
    with: (config: TConfig) => {
      return {
        ...object,
        [symbolMiddlewareConfigured]: true,
        config: {
          ...object.config,
          ...config,
        },
      };
    },
    everywhere(options: MiddlewareEverywhereOptions = {}) {
      const { tasks = true, resources = true } = options;

      return {
        ...object,
        [symbols.middlewareEverywhereTasks]: tasks,
        [symbols.middlewareEverywhereResources]: resources,
        everywhere() {
          throw Errors.middlewareAlreadyGlobal(object.id);
        },
      };
    },
  };
}

export function isTask(definition: any): definition is ITask {
  return definition && definition[symbols.task];
}

export function isResource(definition: any): definition is IResource {
  return definition && definition[symbols.resource];
}

export function isResourceWithConfig(
  definition: any
): definition is IResourceWithConfig {
  return definition && definition[symbols.resourceWithConfig];
}

export function isEvent(definition: any): definition is IEvent {
  return definition && definition[symbols.event];
}

export function isMiddleware(definition: any): definition is IMiddleware {
  return definition && definition[symbols.middleware];
}

/**
 * Override helper that preserves the original `id` and returns the same type.
 * You can override any property except `id`.
 */
export function defineOverride<T extends ITask<any, any, any, any>>(
  base: T,
  patch: Omit<Partial<T>, "id">
): T;
export function defineOverride<T extends IResource<any, any, any, any>>(
  base: T,
  patch: Omit<Partial<T>, "id">
): T;
export function defineOverride<T extends IMiddleware<any, any>>(
  base: T,
  patch: Omit<Partial<T>, "id">
): T;
export function defineOverride(
  base: ITask | IResource | IMiddleware,
  patch: Record<string | symbol, unknown>
): ITask | IResource | IMiddleware {
  const { id: _ignored, ...rest } = (patch || {}) as any;
  // Ensure we never change the id, and merge overrides last
  return {
    ...(base as any),
    ...rest,
    id: (base as any).id,
  } as any;
}
