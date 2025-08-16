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
import { ResourceNotFoundError } from "./errors";

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
): IResource<void, Promise<ReturnType<typeof buildTestFacade>>> {
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
      ...args: I extends undefined ? [] : [I]
    ): Promise<Awaited<O> | undefined> =>
      deps.taskRunner.run(task, ...args) as any,
    // Access a resource value by id (string or symbol)
    getResource: (id: string) => {
      const entry = deps.store.resources.get(id);
      if (!entry) {
        throw new ResourceNotFoundError(id);
      }
      return entry.value;
    },
    // Expose internals when needed in tests (not recommended for app usage)
    taskRunner: deps.taskRunner,
    store: deps.store,
    logger: deps.logger,
    eventManager: deps.eventManager,
  };
}
