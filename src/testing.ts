import { defineResource } from "./define";
import { globalResources } from "./globals/globalResources";
import {
  IResource,
  IResourceWithConfig,
  IMiddleware,
  ITask,
  RegisterableItems,
  IEvent,
  IEventEmission,
  DependencyMapType,
  DependencyValuesType,
} from "./defs";
import { EventManager, Logger, Store, TaskRunner } from "./models";

let testResourceCounter = 0;

/**
 * Helper to create a minimal test harness resource that wraps a root app (or any registerable)
 * and exposes convenient testing utilities while running the full ecosystem
 * (registration, overrides, middleware, events) without modifying the core API.
 */
export function createTestResource(
  root: RegisterableItems,
  options?: {
    overrides?: Array<IResource | ITask | IMiddleware | IResourceWithConfig>;
  }
): IResource<void, ReturnType<typeof buildTestFacade>> {
  return defineResource({
    id: `tests.createTestResource.${++testResourceCounter}`,
    register: [root],
    overrides: options?.overrides || [],
    dependencies: {
      taskRunner: globalResources.taskRunner,
      store: globalResources.store,
      logger: globalResources.logger,
      eventManager: globalResources.eventManager,
    },
    async init(_, deps) {
      return buildTestFacade(deps);
    },
  });
}

function buildTestFacade(deps: {
  taskRunner: TaskRunner;
  store: Store;
  logger: Logger;
  eventManager: EventManager;
}) {
  return {
    // Run a task within the fully initialized ecosystem
    runTask: <I, O extends Promise<any>, D extends DependencyMapType>(
      task: ITask<I, O, D>,
      input: I,
      depsOverride?: DependencyValuesType<D>
    ): Promise<Awaited<O> | undefined> =>
      deps.taskRunner.run(task, input, depsOverride as any) as any,
    // Access a resource value by id (string or symbol)
    getResource: (id: string | symbol) => deps.store.resources.get(id)?.value,
    // Subscribe to events for assertions
    on: <T>(event: IEvent<T>, handler: (e: IEventEmission<T>) => any) =>
      deps.eventManager.addListener(event, handler as any),
    // Expose internals when needed in tests (not recommended for app usage)
    taskRunner: deps.taskRunner,
    store: deps.store,
    logger: deps.logger,
    eventManager: deps.eventManager,
  };
}
