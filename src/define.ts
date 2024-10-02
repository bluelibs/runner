import {
  ITask,
  ITaskDefinition,
  IResource,
  IResourceWithConfig,
  IResourceDefinintion,
  IEventDefinition,
  IMiddlewareDefinition,
  symbols,
  DependencyMapType,
  DependencyValuesType,
  IMiddleware,
} from "./defs";
import { Errors } from "./errors";

export function defineTask<
  Input = undefined,
  Output extends Promise<any> = any,
  Deps extends DependencyMapType = any,
  Test = any
>(
  config: ITaskDefinition<Input, Output, Deps, Test>
): ITask<Input, Output, Deps, Test> {
  return {
    [symbols.task]: true,
    id: config.id,
    dependencies: config.dependencies || ({} as Deps),
    middleware: config.middleware || [],
    run: config.run,
    on: config.on,
    events: {
      beforeRun: defineEvent({
        id: `${config.id}.beforeRun`,
      }),
      afterRun: defineEvent({
        id: `${config.id}.afterRun`,
      }),
      onError: defineEvent({
        id: `${config.id}.onError`,
      }),
    },
    // autorun,
  };
}

export function defineResource<
  TConfig = void,
  TValue = any,
  TDeps extends DependencyMapType = {}
>(
  constConfig: IResourceDefinintion<TConfig, TValue, TDeps>
): IResource<TConfig, TValue, TDeps> {
  return {
    [symbols.resource]: true,
    id: constConfig.id,
    dependencies: constConfig.dependencies,
    hooks: constConfig.hooks || [],
    dispose: constConfig.dispose,
    register: constConfig.register || [],
    init: constConfig.init,
    with: function (config: TConfig) {
      return {
        [symbols.resourceWithConfig]: true,
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
  };
}

export function defineEvent<TPayload = any>(
  config: IEventDefinition<TPayload>
): IEventDefinition<TPayload> {
  return {
    [symbols.event]: true,
    ...config,
  };
}

export function defineMiddleware<TDeps extends DependencyMapType = {}>(
  config: IMiddlewareDefinition<TDeps>
): IMiddleware<TDeps> {
  const object = {
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
