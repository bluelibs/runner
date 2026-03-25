import { EventManager, Logger, RunResult, Store, TaskRunner } from "../models";
import { RunnerMode } from "../defs";
import {
  ResourceLifecycleMode,
  type ResolvedRunOptions,
} from "../types/runner";

const testRunOptions: ResolvedRunOptions = {
  logs: {
    printThreshold: "info",
    printStrategy: "pretty",
    bufferLogs: false,
  },
  errorBoundary: true,
  shutdownHooks: false,
  dispose: {
    totalBudgetMs: 30_000,
    drainingBudgetMs: 20_000,
    abortWindowMs: 0,
    cooldownWindowMs: 0,
  },
  onUnhandledError: jest.fn(),
  dryRun: false,
  executionContext: null,
  identity: null,
  lazy: false,
  lifecycleMode: ResourceLifecycleMode.Sequential,
  mode: RunnerMode.TEST,
};

/**
 * Creates a standard test fixture with EventManager, Logger, and Store.
 * This ensures consistency across model tests and avoids boilerplate.
 */
export function createTestFixture() {
  const eventManager = new EventManager();
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
        testRunOptions,
        async () => store.dispose(),
        () => {},
        () => false,
      ),
  };
}
