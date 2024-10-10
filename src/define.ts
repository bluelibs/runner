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
  IHookDefinition,
  IEvent,
  IEventDefinitionConfig,
  symbolEvent,
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
  return {
    [symbols.task]: true,
    [symbols.filePath]: getCallerFile(),
    id: taskConfig.id,
    dependencies: taskConfig.dependencies || ({} as Deps),
    middleware: taskConfig.middleware || [],
    run: taskConfig.run,
    on: taskConfig.on,
    events: {
      beforeRun: defineEvent({
        id: `${taskConfig.id}.beforeRun`,
      }),
      afterRun: defineEvent({
        id: `${taskConfig.id}.afterRun`,
      }),
      onError: defineEvent({
        id: `${taskConfig.id}.onError`,
      }),
    },
    meta: taskConfig.meta || {},
    // autorun,
  };
}

export function defineResource<
  TConfig = void,
  TValue = any,
  TDeps extends DependencyMapType = {},
  THooks = any
>(
  constConfig: IResourceDefinition<TConfig, TValue, TDeps, THooks>
): IResource<TConfig, TValue, TDeps> {
  return {
    [symbols.resource]: true,
    [symbols.filePath]: getCallerFile(),
    id: constConfig.id,
    dependencies: constConfig.dependencies,
    dispose: constConfig.dispose,
    register: constConfig.register || [],
    overrides: constConfig.overrides || [],
    init: constConfig.init,
    with: function (config: TConfig) {
      return {
        [symbols.resourceWithConfig]: true,
        id: this.id,
        resource: this,
        config,
      };
    },

    events: {
      beforeInit: defineEvent({
        id: `${constConfig.id}.beforeInit`,
      }),
      afterInit: defineEvent({
        id: `${constConfig.id}.afterInit`,
      }),
      onError: defineEvent({
        id: `${constConfig.id}.onError`,
      }),
    },
    meta: constConfig.meta || {},
    middleware: constConfig.middleware || [],
  };
}

export function defineEvent<TPayload = any>(
  config: IEventDefinitionConfig<TPayload>
): IEventDefinition<TPayload> {
  return {
    [symbols.filePath]: getCallerFile(),
    [symbolEvent]: true,
    ...config,
  };
}

export function defineMiddleware<TDeps extends DependencyMapType = {}>(
  config: IMiddlewareDefinition<TDeps>
): IMiddleware<TDeps> {
  const object = {
    [symbols.filePath]: getCallerFile(),
    [symbols.middleware]: true,
    ...config,
    dependencies: config.dependencies || ({} as TDeps),
  };

  return {
    ...object,
    global() {
      return {
        ...object,
        [symbols.middlewareGlobal]: true,
        global() {
          throw Errors.middlewareAlreadyGlobal(config.id);
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

export function isEvent(definition: any): definition is IEventDefinition {
  return definition && definition[symbols.event];
}

export function isMiddleware(definition: any): definition is IMiddleware {
  return definition && definition[symbols.middleware];
}
