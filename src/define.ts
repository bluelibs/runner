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
  DependencyMapType,
  DependencyValuesType,
  IMiddleware,
  IEvent,
  symbolEvent,
  RegisterableItems,
  symbolMiddlewareConfigured,
  symbolFilePath,
  symbolIndexResource,
  ITag,
  ITagDefinition,
  ITagWithConfig,
  TagType,
  ITaggable,
  symbolTask,
  symbolMiddlewareEverywhereTasks,
  symbolMiddlewareEverywhereResources,
  symbolResourceWithConfig,
  symbolResource,
  symbolMiddleware,
  ITaskMeta,
  IResourceMeta,
} from "./defs";
import { MiddlewareAlreadyGlobalError } from "./errors";
import { generateCallerIdFromFile, getCallerFile } from "./tools/getCallerFile";

// Helper function to get the caller file

export function defineTask<
  Input = undefined,
  Output extends Promise<any> = any,
  Deps extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition | undefined = undefined,
  TMeta extends ITaskMeta = any
>(
  taskConfig: ITaskDefinition<Input, Output, Deps, TOn, TMeta>
): ITask<Input, Output, Deps, TOn, TMeta> {
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
    [symbolTask]: true,
    [symbolFilePath]: filePath,
    id,
    dependencies: taskConfig.dependencies || ({} as Deps),
    middleware: taskConfig.middleware || [],
    run: taskConfig.run,
    on: taskConfig.on,
    listenerOrder: taskConfig.listenerOrder,
    inputSchema: taskConfig.inputSchema,
    events: {
      beforeRun: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-task.events.beforeRun`)
            : `${id as string}.events.beforeRun`,
        }),
        [symbolFilePath]: getCallerFile(),
      },
      afterRun: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-task.events.afterRun`)
            : `${id as string}.events.afterRun`,
        }),
        [symbolFilePath]: getCallerFile(),
      },
      onError: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-task.events.onError`)
            : `${id as string}.events.onError`,
        }),
        [symbolFilePath]: getCallerFile(),
      },
    },
    meta: taskConfig.meta || ({} as TMeta),
    // autorun,
  };
}

export function defineResource<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TPrivate = any,
  TMeta extends IResourceMeta = any
>(
  constConfig: IResourceDefinition<
    TConfig,
    TValue,
    TDeps,
    TPrivate,
    any,
    any,
    TMeta
  >
): IResource<TConfig, TValue, TDeps, TPrivate, TMeta> {
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
    [symbolResource]: true,
    [symbolFilePath]: filePath,
    [symbolIndexResource]: isIndexResource,
    id,
    dependencies: constConfig.dependencies,
    dispose: constConfig.dispose,
    register: constConfig.register || [],
    overrides: constConfig.overrides || [],
    init: constConfig.init,
    context: constConfig.context,
    configSchema: constConfig.configSchema,
    with: function (config: TConfig) {
      // Validate config with schema if provided (fail fast)
      if (this.configSchema) {
        try {
          config = this.configSchema.parse(config);
        } catch (error) {
          throw new Error(`Resource config validation failed for ${this.id.toString()}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      return {
        [symbolResourceWithConfig]: true,
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
        [symbolFilePath]: filePath,
      },
      afterInit: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-resource.events.afterInit`)
            : `${id as string}.events.afterInit`,
        }),
        [symbolFilePath]: filePath,
      },
      onError: {
        ...defineEvent({
          id: isAnonymous
            ? Symbol(`anonymous-resource.events.onError`)
            : `${id as string}.events.onError`,
        }),
        [symbolFilePath]: filePath,
      },
    },
    meta: (constConfig.meta || {}) as TMeta,
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
>(items: T): IResource<void, Promise<DependencyValuesType<D>>, D> {
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
    [symbolFilePath]: callerFilePath,
    [symbolIndexResource]: true,
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
    [symbolFilePath]: callerFilePath,
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
    [symbolFilePath]: filePath,
    [symbolMiddleware]: true,
    config: {} as TConfig,
    id: middlewareDef.id || generateCallerIdFromFile(filePath, "middleware"),
    ...middlewareDef,
    dependencies: middlewareDef.dependencies || ({} as TDependencies),
  } as IMiddleware<TConfig, TDependencies>;

  return {
    ...object,
    with: (config: TConfig) => {
      // Validate config with schema if provided (fail fast)
      if (object.configSchema) {
        try {
          config = object.configSchema.parse(config);
        } catch (error) {
          throw new Error(`Middleware config validation failed for ${object.id.toString()}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
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
        [symbolMiddlewareEverywhereTasks]: tasks,
        [symbolMiddlewareEverywhereResources]: resources,
        everywhere() {
          throw new MiddlewareAlreadyGlobalError(object.id);
        },
      };
    },
  };
}

export function isTask(definition: any): definition is ITask {
  return definition && definition[symbolTask];
}

export function isResource(definition: any): definition is IResource {
  return definition && definition[symbolResource];
}

export function isResourceWithConfig(
  definition: any
): definition is IResourceWithConfig {
  return definition && definition[symbolResourceWithConfig];
}

export function isEvent(definition: any): definition is IEvent {
  return definition && definition[symbolEvent];
}

export function isMiddleware(definition: any): definition is IMiddleware {
  return definition && definition[symbolMiddleware];
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

/**
 * Creates a tag definition.
 * - `.with(config)` to create configured instances
 * - `.extract(tags)` to extract this tag from a list of tags
 */
export function defineTag<TConfig = void, TEnforceContract = void>(
  definition: ITagDefinition<TConfig, TEnforceContract>
): ITag<TConfig, TEnforceContract> {
  const id = definition.id;

  return {
    id,
    with(tagConfig: TConfig) {
      return {
        id,
        tag: this,
        config: tagConfig as any,
      } as ITagWithConfig<TConfig>;
    },
    extract(target: TagType[] | ITaggable) {
      const tags = Array.isArray(target) ? target : target?.meta?.tags || [];
      for (const candidate of tags) {
        if (typeof candidate === "string") continue;
        // Configured instance
        if (candidate.id === id) {
          return candidate as ITagWithConfig<TConfig>;
        }
      }
      return null;
    },
  } as ITag<TConfig>;
}
