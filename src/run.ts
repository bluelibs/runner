import { TaskRunner } from "./TaskRunner";
import {
  DependencyMapType,
  ITaskDefinition,
  IResourceDefinintion,
  IEventDefinition,
  IMiddlewareDefinition,
  DependencyValuesType,
  IResource,
} from "./defs";
import { DependencyProcessor } from "./DependencyProcessor";
import { EventManager } from "./EventManager";
import { globalEvents } from "./globalEvents";
import { Store } from "./Store";
import { findCircularDependencies } from "./tools/findCircularDependencies";
import { Errors } from "./errors";
import { globalResources } from "./globalResources";

export type ResourcesStoreElementType<
  C = any,
  V = any,
  D extends DependencyMapType = {}
> = {
  resource: IResourceDefinintion<C, V, D>;
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

export type RunnerType = {
  store: Store;
  eventManager: EventManager;
  taskRunner: TaskRunner;
};

export async function run<C, V>(
  resource: IResource<C>,
  config?: C
): Promise<V> {
  const eventManager = new EventManager();
  const store = new Store(eventManager);
  const taskRunner = new TaskRunner(store, eventManager);
  const processor = new DependencyProcessor(store, eventManager, taskRunner);

  // In the registration phase we register deeply all the resources, tasks, middleware and events
  store.initializeStore(resource, config);
  store.storeGenericItem(globalResources.taskRunner.with(taskRunner));
  store.computeRegisterOfResource(resource, config);

  // We verify that there isn't any circular dependencies before we begin computing the dependencies
  const dependentNodes = store.getDependentNodes();
  const circularDependencies = findCircularDependencies(dependentNodes);
  if (circularDependencies.cycles.length > 0) {
    throw Errors.circularDependencies(circularDependencies.cycles);
  }

  await processor.processHooks();

  // Now we can safely compute dependencies without being afraid of an infinite loop.
  // The hooking part is done here.
  await eventManager.emit(globalEvents.beforeInit);

  await processor.computeAllDependencies();

  // leftovers that were registered but not depended upon, except root
  await processor.initializeUninitializedResources();

  // Now we can initialise the root resource
  await processor.initializeRoot();

  await eventManager.emit(globalEvents.afterInit);

  return store.root.value;
}
