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

type DisposableWrapper<V> = V extends null | undefined 
  ? { dispose(): Promise<void> } & { valueOf(): V; toString(): string }
  : V & { dispose(): Promise<void> };

export async function run<C, V>(
  resource: IResource<C, V>,
  config?: C
): Promise<DisposableWrapper<V>> {
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

  return createDisposableWrapper(store.root.value, store);
}

function createDisposableWrapper<V>(value: V, store: Store): DisposableWrapper<V> {
  // Handle null and undefined specially
  if (value === null || value === undefined) {
    const wrapper = Object.create(Object.prototype);
    wrapper.valueOf = () => value;
    wrapper.toString = () => String(value);
    wrapper.dispose = () => store.dispose();
    // Make it behave like the original value
    wrapper[Symbol.toPrimitive] = () => value;
    return wrapper as DisposableWrapper<V>;
  }

  // For objects, add dispose method directly
  if (typeof value === "object" && value !== null) {
    Object.defineProperty(value, "dispose", {
      value: () => store.dispose(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return value as DisposableWrapper<V>;
  }

  // For primitives, we need to create a more sophisticated wrapper
  // that inherits from the appropriate primitive wrapper type
  let wrapper: any;
  
  if (typeof value === "string") {
    wrapper = Object.create(String.prototype);
    wrapper.valueOf = () => value;
    wrapper.toString = () => value;
    wrapper[Symbol.toPrimitive] = () => value;
    // Copy all string properties and methods
    Object.getOwnPropertyNames(String.prototype).forEach(prop => {
      if (prop !== "constructor" && typeof String.prototype[prop as keyof String] === "function") {
        wrapper[prop] = function(...args: any[]) {
          return (String.prototype[prop as keyof String] as any).apply(value, args);
        };
      }
    });
  } else if (typeof value === "number") {
    wrapper = Object.create(Number.prototype);
    wrapper.valueOf = () => value;
    wrapper.toString = () => String(value);
    wrapper[Symbol.toPrimitive] = (hint?: string) => {
      if (hint === "number") return Number(value);
      if (hint === "string") return String(value);
      return value;
    };
  } else if (typeof value === "boolean") {
    wrapper = Object.create(Boolean.prototype);
    wrapper.valueOf = () => value;
    wrapper.toString = () => String(value);
    wrapper[Symbol.toPrimitive] = () => value;
  } else {
    // For other primitive types (null, undefined, etc.)
    wrapper = Object.create(Object.prototype);
    wrapper.valueOf = () => value;
    wrapper.toString = () => String(value);
  }

  wrapper.dispose = () => store.dispose();

  return wrapper as DisposableWrapper<V>;
}
