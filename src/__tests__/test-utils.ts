import { EventManager, Logger, RunResult, Store, TaskRunner } from "../models";
import { RunnerMode } from "../defs";

/**
 * Creates a standard test fixture with EventManager, Logger, and Store.
 * This ensures consistency across model tests and avoids boilerplate.
 */
export function createTestFixture() {
  const eventManager = new EventManager({ runtimeEventCycleDetection: true });
  const logger = new Logger({
    printThreshold: "info",
    printStrategy: "pretty",
    bufferLogs: false,
  });
  const onUnhandledError = jest.fn();
  const store = new Store(
    eventManager,
    logger,
    onUnhandledError,
    RunnerMode.TEST,
  );

  return {
    eventManager,
    logger,
    onUnhandledError,
    store,
    createTaskRunner: () => new TaskRunner(store, eventManager, logger),
    createRuntimeResult: (taskRunner?: TaskRunner) =>
      new RunResult<unknown>(
        logger,
        store,
        eventManager,
        taskRunner ?? new TaskRunner(store, eventManager, logger),
        async () => store.dispose(),
      ),
  };
}
