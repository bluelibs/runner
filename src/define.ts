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
  const filePath = getCallerFile();
  return {
    [symbols.task]: true,
    [symbols.filePath]: filePath,
    id: taskConfig.id,
    dependencies: taskConfig.dependencies || ({} as Deps),
    middleware: taskConfig.middleware || [],
    run: taskConfig.run,
    on: taskConfig.on,
    events: {
      beforeRun: {
        ...defineEvent({
          id: `${taskConfig.id}.events.beforeRun`,
        }),
        [symbols.filePath]: getCallerFile(),
      },
      afterRun: {
        ...defineEvent({
          id: `${taskConfig.id}.events.afterRun`,
        }),
        [symbols.filePath]: getCallerFile(),
      },
      onError: {
        ...defineEvent({
          id: `${taskConfig.id}.events.onError`,
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
  THooks = any
>(
  constConfig: IResourceDefinition<TConfig, TValue, TDeps, THooks>
): IResource<TConfig, TValue, TDeps> {
  const filePath = getCallerFile();
  return {
    [symbols.resource]: true,
    [symbols.filePath]: filePath,
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
      beforeInit: {
        ...defineEvent({
          id: `${constConfig.id}.events.beforeInit`,
        }),
        [symbols.filePath]: filePath,
      },
      afterInit: {
        ...defineEvent({
          id: `${constConfig.id}.events.afterInit`,
        }),
        [symbols.filePath]: filePath,
      },
      onError: {
        ...defineEvent({
          id: `${constConfig.id}.events.onError`,
        }),
        [symbols.filePath]: filePath,
      },
    },
    meta: constConfig.meta || {},
    middleware: constConfig.middleware || [],
  };
}

// Interface for private context resource definition
interface IPrivateContextResourceDefinition<
  TConfig,
  TValue,
  TDeps extends DependencyMapType,
  TPrivate
> extends Omit<IResourceDefinition<TConfig, TValue, TDeps>, 'init' | 'dispose'> {
  private?: () => TPrivate;
  init?: (this: { private: TPrivate }, config: TConfig, deps: DependencyValuesType<TDeps>) => Promise<TValue>;
  dispose?: (this: { private: TPrivate }, value: TValue, config: TConfig, deps: DependencyValuesType<TDeps>) => Promise<void>;
}

// Enhanced resource function with private context support
export function resource<
  TConfig = void,
  TValue = any,
  TDeps extends DependencyMapType = {},
  TPrivate = {}
>(
  definition: IPrivateContextResourceDefinition<TConfig, TValue, TDeps, TPrivate>
): IResource<TConfig, TValue, TDeps> {
  // Create a closure to hold private state
  let privateState: TPrivate;
  
  return defineResource({
    ...definition,
    init: definition.init ? async (config: TConfig, deps: DependencyValuesType<TDeps>) => {
      // Reset private state for each initialization
      privateState = definition.private?.() || ({} as TPrivate);
      
      // Bind init function with private context
      const boundInit = definition.init!.bind({ private: privateState });
      return await boundInit(config, deps);
    } : undefined as any,
    dispose: definition.dispose ? async (value: TValue, config: TConfig, deps: DependencyValuesType<TDeps>) => {
      // Bind dispose function with same private context
      const boundDispose = definition.dispose!.bind({ private: privateState });
      await boundDispose(value, config, deps);
    } : undefined,
  } as IResourceDefinition<TConfig, TValue, TDeps>);
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
