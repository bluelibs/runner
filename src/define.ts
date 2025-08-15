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
import { MiddlewareAlreadyGlobalError, ValidationError } from "./errors";
import { generateCallerIdFromFile, getCallerFile } from "./tools/getCallerFile";

// Helper function to get the caller file

/**
 * Define a task.
 * Generates a strongly-typed task object with id, lifecycle events, dependencies,
 * middleware, and metadata.
 *
 * - If `id` is omitted, an anonymous, file-based id is generated.
 * - Wires lifecycle events: `beforeRun`, `afterRun`, `onError`.
 * - Carries through dependencies, middleware, input schema, and metadata.
 *
 * @typeParam Input - Input type accepted by the task's `run` function.
 * @typeParam Output - Promise type returned by the `run` function.
 * @typeParam Deps - Dependency map type this task requires.
 * @typeParam TOn - Event type or "*" this task listens to.
 * @typeParam TMeta - Arbitrary metadata type carried by the task.
 * @param taskConfig - The task definition config.
 * @returns A branded task definition usable by the runner.
 */
export function defineTask<
  Input = undefined,
  Output extends Promise<any> = any,
  Deps extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition | undefined = undefined,
  TMeta extends ITaskMeta = any
>(
  taskConfig: ITaskDefinition<Input, Output, Deps, TOn, TMeta>
): ITask<Input, Output, Deps, TOn, TMeta> {
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
   * Define a resource.
   * Produces a strongly-typed resource with id, lifecycle events, registration hooks,
   * and optional config schema.
   *
   * - If `id` is omitted, an anonymous, file-based id is generated (resource or index flavored).
   * - Wires lifecycle events: `beforeInit`, `afterInit`, `onError`.
   * - Provides `.with(config)` for config-bound registration with optional runtime validation.
   *
   * @typeParam TConfig - Configuration type accepted by the resource.
   * @typeParam TValue - Promise type resolved by the resource `init`.
   * @typeParam TDeps - Dependency map type this resource requires.
   * @typeParam TPrivate - Private context type exposed to middleware during init.
   * @typeParam TMeta - Arbitrary metadata type carried by the resource.
   * @param constConfig - The resource definition config.
   * @returns A branded resource definition usable by the runner.
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
          throw new ValidationError(
            "Resource config",
            this.id,
            error instanceof Error ? error : new Error(String(error))
          );
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
   * Define an event.
   * Generates a branded event definition with a stable id (anonymous if omitted)
   * and file path metadata for better debugging.
   *
   * @typeParam TPayload - Payload type carried by the event.
   * @param config - Optional event definition (id, etc.).
   * @returns A branded event definition.
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
   * Attach to all tasks. Default is true. Can be a boolean or a predicate that receives the task for filtering. If the function returns false, the middleware is **not** attached to the task.
   */
  tasks?: boolean | ((task: ITask<any, any, any, any>) => boolean);
  /**
   * Attach to all resources. Default is true.
   */
  resources?: boolean;
};

/**
 * Define a middleware.
 * Creates a middleware definition with anonymous id generation, `.with(config)`,
 * and `.everywhere()` helpers.
 *
 * - `.with(config)` merges config (optionally validated via `configSchema`).
 * - `.everywhere()` marks the middleware global (optionally scoping to tasks/resources).
 *
 * @typeParam TConfig - Configuration type accepted by the middleware.
 * @typeParam TDependencies - Dependency map type required by the middleware.
 * @param middlewareDef - The middleware definition config.
 * @returns A branded middleware definition usable by the runner.
 */
export function defineMiddleware<
  TConfig extends Record<string, any> = any,
  TDependencies extends DependencyMapType = any
>(
  middlewareDef: IMiddlewareDefinition<TConfig, TDependencies>
): IMiddleware<TConfig, TDependencies> {
  const filePath = getCallerFile();
  const base = {
    [symbolFilePath]: filePath,
    [symbolMiddleware]: true,
    config: {} as TConfig,
    id: middlewareDef.id || generateCallerIdFromFile(filePath, "middleware"),
    ...middlewareDef,
    dependencies: middlewareDef.dependencies || ({} as TDependencies),
  } as IMiddleware<TConfig, TDependencies>;

  // Wrap an object to ensure we always return chainable helpers
  const wrap = (
    obj: IMiddleware<TConfig, TDependencies>
  ): IMiddleware<TConfig, TDependencies> => {
    return {
      ...obj,
      with: (config: TConfig) => {
        // Validate config with schema if provided (fail fast)
        if (obj.configSchema) {
          try {
            config = obj.configSchema.parse(config);
          } catch (error) {
            throw new ValidationError(
              "Middleware config",
              obj.id,
              error instanceof Error ? error : new Error(String(error))
            );
          }
        }

        return wrap({
          ...obj,
          [symbolMiddlewareConfigured]: true,
          config: {
            ...(obj.config as TConfig),
            ...config,
          },
        } as IMiddleware<TConfig, TDependencies>);
      },
      everywhere(options: MiddlewareEverywhereOptions = {}) {
        const { tasks = true, resources = true } = options;

        // If already global, prevent calling again
        if (
          obj[symbolMiddlewareEverywhereTasks] ||
          obj[symbolMiddlewareEverywhereResources]
        ) {
          throw new MiddlewareAlreadyGlobalError(obj.id);
        }

        return wrap({
          ...obj,
          [symbolMiddlewareEverywhereTasks]: tasks,
          [symbolMiddlewareEverywhereResources]: resources,
        } as IMiddleware<TConfig, TDependencies>);
      },
    } as IMiddleware<TConfig, TDependencies>;
  };

  return wrap(base);
}

/**
 * Type guard: checks if a definition is a Task.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Task.
 */
export function isTask(definition: any): definition is ITask {
  return definition && definition[symbolTask];
}

/**
 * Type guard: checks if a definition is a Resource.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Resource.
 */
export function isResource(definition: any): definition is IResource {
  return definition && definition[symbolResource];
}

/**
 * Type guard: checks if a definition is a Resource that carries config via `.with()`.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded ResourceWithConfig.
 */
export function isResourceWithConfig(
  definition: any
): definition is IResourceWithConfig {
  return definition && definition[symbolResourceWithConfig];
}

/**
 * Type guard: checks if a definition is an Event.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Event.
 */
export function isEvent(definition: any): definition is IEvent {
  return definition && definition[symbolEvent];
}

/**
 * Type guard: checks if a definition is a Middleware.
 * @param definition - Any value to test.
 * @returns True when `definition` is a branded Middleware.
 */
export function isMiddleware(definition: any): definition is IMiddleware {
  return definition && definition[symbolMiddleware];
}

/**
 * Override helper that preserves the original `id` and returns the same type.
 * You can override any property except `id`. The override is shallow-merged over the base.
 *
 * @param base - The base definition to override.
 * @param patch - Properties to override (except `id`).
 * @returns A definition of the same kind with overrides applied.
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
 * Create a tag definition.
 * - `.with(config)` to create configured instances
 * - `.extract(tags)` to extract this tag from a list of tags or a taggable's meta
 *
 * @typeParam TConfig - Configuration type carried by configured tags.
 * @typeParam TEnforceContract - Optional helper type to enforce a contract when tags are used.
 * @param definition - The tag definition (id).
 * @returns A tag object with helpers to configure and extract.
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
