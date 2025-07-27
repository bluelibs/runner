import { TaskRunner } from "./models/TaskRunner";
import {
  DependencyMapType,
  ITaskDefinition,
  IResourceDefinition,
  IEventDefinition,
  IMiddlewareDefinition,
  DependencyValuesType,
  IResource,
} from "./defs";
import { DependencyProcessor } from "./models/DependencyProcessor";
import { EventManager } from "./models/EventManager";
import { globalEvents } from "./globalEvents";
import { Store } from "./models/Store";
import { findCircularDependencies } from "./tools/findCircularDependencies";
import { Errors } from "./errors";
import { globalResources } from "./globalResources";
import { Logger } from "./models/Logger";

export type ResourcesStoreElementType<
  C = any,
  V = any,
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

export async function run<C, V>(
  resource: IResource<C, V>,
  config?: C
): Promise<{ value: V; dispose: () => Promise<void> }> {
  const eventManager = new EventManager();

  // ensure for logger, that it can be used only after: computeAllDependencies() has executed
  const logger = new Logger(eventManager);

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

  // We verify that there isn't any circular dependencies before we begin computing the dependencies
  const dependentNodes = store.getDependentNodes();
  const circularDependencies = findCircularDependencies(dependentNodes);
  if (circularDependencies.cycles.length > 0) {
    throw Errors.circularDependencies(circularDependencies.cycles);
  }

  // the overrides that were registered now will override the other registered resources
  await store.processOverrides();

  // a form of hooking, we create the events for all tasks and store them so they can be referenced
  await store.storeEventsForAllTasks();
  await processor.attachListeners();
  await processor.computeAllDependencies();

  // After this stage, logger print policy could have been set.
  await logger.debug("All elements have been initalized..");

  // Now we can safely compute dependencies without being afraid of an infinite loop.
  // The hooking part is done here.
  await eventManager.emit(globalEvents.beforeInit, null, resource.id);

  // Now we can initialise the root resource
  await processor.initializeRoot();

  await eventManager.emit(globalEvents.afterInit, null, resource.id);
  await logger.debug("System initialized and operational.");

  // disallow manipulation or attaching more
  store.lock();

  return {
    value: store.root.value,
    dispose: () => store.dispose(),
  };
}
