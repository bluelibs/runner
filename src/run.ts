import { TaskRunner } from "./models/TaskRunner";
import {
  DependencyMapType,
  ITaskDefinition,
  IResourceDefinition,
  IEventDefinition,
  IMiddlewareDefinition,
  DependencyValuesType,
  IResource,
  IResourceWithConfig,
} from "./defs";
import { DependencyProcessor } from "./models/DependencyProcessor";
import { EventManager } from "./models/EventManager";
import { globalEvents } from "./globals/globalEvents";
import { Store } from "./models/Store";
import { findCircularDependencies } from "./tools/findCircularDependencies";
import { CircularDependenciesError } from "./errors";
import { globalResources } from "./globals/globalResources";
import { Logger, LogLevels, PrintStrategy } from "./models/Logger";
import { isResourceWithConfig } from "./define";
import { debugResource, DebugFriendlyConfig } from "./globals/resources/debug";

export type ResourcesStoreElementType<
  C = any,
  V extends Promise<any> = any,
  D extends DependencyMapType = {}
> = {
  resource: IResourceDefinition<C, V, D>;
  computedDependencies?: DependencyValuesType<D>;
  config: C;
  value: V;
};

export type TasksStoreElementType<
  Input = any,
  Output extends Promise<any> = any,
  D extends DependencyMapType = {}
> = {
  task: ITaskDefinition<Input, Output, D>;
  computedDependencies?: DependencyValuesType<D>;
};

export type MiddlewareStoreElementType = {
  middleware: IMiddlewareDefinition;
};

export type EventStoreElementType = {
  event: IEventDefinition;
};

export type RunnerState = {
  tasks: Record<string, TasksStoreElementType>;
  resources: Record<string, ResourcesStoreElementType>;
  events: Record<string, EventStoreElementType>;
  middleware: Record<string, MiddlewareStoreElementType>;
};

export type RunOptions = {
  /**
   * Defaults to false. If true, we introduce logging to the console.
   */
  debug?: DebugFriendlyConfig;
  logs?: {
    /**
     * Defaults to info.
     */
    printThreshold?: LogLevels;
    /**
     * Defaults to PRETTY. How to print the logs.
     */
    printStrategy?: PrintStrategy;
    /**
     * Defaults to false. If true, we buffer logs until the root resource is ready.
     * This provides you with the chance to see the logs before the root resource is ready.
     */
    bufferLogs?: boolean;
  };
};

export async function run<C, V extends Promise<any>>(
  resourceOrResourceWithConfig:
    | IResourceWithConfig<C, V>
    | IResource<void, V, any, any> // For void configs
    | IResource<{ [K in any]?: any }, V, any, any>, // For optional config
  options?: RunOptions
): Promise<{
  value: V extends Promise<infer U> ? U : V;
  store: Store;
  dispose: () => Promise<void>;
}> {
  const { debug = false, logs = {} } = options || {};
  const {
    printThreshold = "info",
    printStrategy = "pretty",
    bufferLogs = false,
  } = logs;

  const eventManager = new EventManager();
  let { resource, config } = extractResourceAndConfig(
    resourceOrResourceWithConfig
  );

  // ensure for logger, that it can be used only after: computeAllDependencies() has executed
  const logger = new Logger({
    printThreshold,
    printStrategy,
    bufferLogs,
  });

  const store = new Store(eventManager, logger);
  const taskRunner = new TaskRunner(store, eventManager, logger);
  const processor = new DependencyProcessor(
    store,
    eventManager,
    taskRunner,
    logger
  );

  // In the registration phase we register deeply all the resources, tasks, middleware and events
  store.initializeStore(resource, config);
  store.storeGenericItem(globalResources.logger.with(logger));
  store.storeGenericItem(globalResources.taskRunner.with(taskRunner));

  if (debug) {
    store.storeGenericItem(debugResource.with(debug));
  }

  // We verify that there isn't any circular dependencies before we begin computing the dependencies
  const dependentNodes = store.getDependentNodes();
  const circularDependencies = findCircularDependencies(dependentNodes);
  if (circularDependencies.cycles.length > 0) {
    throw new CircularDependenciesError(circularDependencies.cycles);
  }

  // the overrides that were registered now will override the other registered resources
  await store.processOverrides();

  // a form of hooking, we create the events for all tasks and store them so they can be referenced
  await store.storeEventsForAllTRM();
  await processor.attachListeners();
  await processor.computeAllDependencies();

  // After this stage, logger print policy could have been set.
  await logger.debug("All elements have been initalized..");

  // Now we can safely compute dependencies without being afraid of an infinite loop.
  // The hooking part is done here.

  // Now we can initialise the root resource
  await processor.initializeRoot();

  await logger.debug("System initialized and operational.");

  // disallow manipulation or attaching more
  store.lock();
  eventManager.lock();
  await logger.lock();

  await eventManager.emit(
    globalEvents.ready,
    {
      root: store.root.resource,
    },
    "system"
  );

  return {
    value: store.root.value,
    dispose: () => store.dispose(),
    store,
  };
}
function extractResourceAndConfig<C, V extends Promise<any>>(
  resourceOrResourceWithConfig:
    | IResourceWithConfig<C, V>
    | IResource<void, V, any, any> // For void configs
    | IResource<{ [K in any]?: any }, V, any, any> // For optional config
) {
  let resource: IResource<any, any, any, any>;
  let config: any;
  if (isResourceWithConfig(resourceOrResourceWithConfig)) {
    resource = resourceOrResourceWithConfig.resource;
    config = resourceOrResourceWithConfig.config;
  } else {
    resource = resourceOrResourceWithConfig as IResource<any, any, any, any>;
    config = undefined;
  }
  return { resource, config };
}
