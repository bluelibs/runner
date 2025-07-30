import { get } from "node:http";
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
} from "./defs";
import { Errors } from "./errors";
import { getCallerFile } from "./tools/getCallerFile";

// Helper function to get the caller file

export function defineTask<
  Input = undefined,
  Output extends Promise<any> = any,
  Deps extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition | undefined = undefined
>(
  taskConfig: ITaskDefinition<Input, Output, Deps, TOn>
): ITask<Input, Output, Deps, TOn> {
  const filePath = getCallerFile();
  const isAnonymous = !Boolean(taskConfig.id);
  const id = taskConfig.id || Symbol("anonymous-task");
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
  const filePath = getCallerFile();
  const isAnonymous = !Boolean(constConfig.id);
  const id = constConfig.id || Symbol("anonymous-resource");
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

  return defineResource({
    id: `index.${Math.random().toString(36).slice(2)}`,
    register,
    dependencies,
    async init(_, deps) {
      return deps as any;
    },
  });
}

export function defineEvent<TPayload = any>(
  config: IEventDefinition<TPayload>
): IEvent<TPayload> {
  return {
    ...config,
    id: config.id || Symbol("anonymous-event"),
    [symbols.filePath]: getCallerFile(),
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
  const object = {
    [symbols.filePath]: getCallerFile(),
    [symbols.middleware]: true,
    config: {} as TConfig,
    id: middlewareDef.id || Symbol("anonymous-middleware"),
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
