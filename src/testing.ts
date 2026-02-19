import { defineResource } from "./define";
import { globalResources } from "./globals/globalResources";
import {
  IResource,
  IResourceWithConfig,
  ITaskMiddleware,
  IResourceMiddleware,
  ITask,
  RegisterableItems,
  DependencyMapType,
} from "./defs";
import { EventManager, Logger, Store, TaskRunner } from "./models";

let testResourceCounter = 0;

export interface TestFacade {
  runTask: <I, O extends Promise<any>, D extends DependencyMapType>(
    task: ITask<I, O, D>,
    ...args: I extends undefined ? [] : [I]
  ) => Promise<Awaited<O> | undefined>;
  getResource: (id: string) => unknown;
  taskRunner: TaskRunner;
  store: Store;
  logger: Logger;
  eventManager: EventManager;
}

/**
 * Helper to create a minimal test harness resource that wraps a root app (or any registerable)
 * and exposes convenient testing utilities while running the full ecosystem
 * (registration, overrides, middleware, events) without modifying the core API.
 * @deprecated Use run() in your tests instead, which provides the same benefits with a more flexible API and better type safety.
 */
export function createTestResource(
  root: RegisterableItems,
  options?: {
    overrides?: Array<
      | IResource
      | ITask
      | ITaskMiddleware
      | IResourceMiddleware
      | IResourceWithConfig
    >;
  },
): IResource<void, Promise<TestFacade>> {
  return defineResource({
    id: `testing.${root.id}.${++testResourceCounter}`,
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
}): TestFacade {
  return {
    // Run a task within the fully initialized ecosystem
    runTask: <I, O extends Promise<any>, D extends DependencyMapType>(
      task: ITask<I, O, D>,
      ...args: I extends undefined ? [] : [I]
    ): Promise<Awaited<O> | undefined> =>
      deps.taskRunner.run(task, ...args) as Promise<Awaited<O> | undefined>,
    // Access a resource value by id (string or symbol)
    getResource: (id: string) => deps.store.resources.get(id)?.value,
    // Expose internals when needed in tests (not recommended for app usage)
    taskRunner: deps.taskRunner,
    store: deps.store,
    logger: deps.logger,
    eventManager: deps.eventManager,
  };
}
