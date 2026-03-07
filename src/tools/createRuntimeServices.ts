import { TaskRunner } from "../models/TaskRunner";
import { DependencyProcessor } from "../models/DependencyProcessor";
import { EventManager } from "../models/EventManager";
import { Store } from "../models/Store";
import { Logger, LogLevels, PrintStrategy } from "../models/Logger";
import {
  OnUnhandledError,
  createDefaultUnhandledError,
  bindProcessErrorHandler,
} from "../models/UnhandledError";
import { registerProcessLevelSafetyNets } from "./processShutdownHooks";
import { ResourceLifecycleMode } from "../types/runner";
import { LifecycleAdmissionController } from "../models/runtime/LifecycleAdmissionController";

export type CreateRuntimeServicesInput = {
  lifecycleMode: ResourceLifecycleMode;
  runtimeEventCycleDetection: boolean;
  lazy: boolean;
  errorBoundary: boolean;
  onUnhandledError?: OnUnhandledError;
  printThreshold: LogLevels | null;
  printStrategy: PrintStrategy;
  bufferLogs: boolean;
};

export type RuntimeServices = {
  logger: Logger;
  store: Store;
  eventManager: EventManager;
  taskRunner: TaskRunner;
  processor: DependencyProcessor;
  onUnhandledError: OnUnhandledError;
  unhookProcessSafetyNets: (() => void) | undefined;
};

/**
 * Creates and wires the core runtime services needed for a single run() invocation.
 * Each call produces a fully isolated set of services.
 */
export function createRuntimeServices(
  input: CreateRuntimeServicesInput,
): RuntimeServices {
  const lifecycleAdmissionController = new LifecycleAdmissionController();
  const eventManager = new EventManager({
    runtimeEventCycleDetection: input.runtimeEventCycleDetection,
    lifecycleAdmissionController,
  });

  const logger = new Logger({
    printThreshold: input.printThreshold,
    printStrategy: input.printStrategy,
    bufferLogs: input.bufferLogs,
  });

  const onUnhandledError: OnUnhandledError =
    input.onUnhandledError ?? createDefaultUnhandledError(logger);

  const store = new Store(
    eventManager,
    logger,
    onUnhandledError,
    undefined,
    lifecycleAdmissionController,
  );
  const taskRunner = new TaskRunner(store, eventManager, logger);
  store.setTaskRunner(taskRunner);

  let unhookProcessSafetyNets: (() => void) | undefined;
  if (input.errorBoundary) {
    unhookProcessSafetyNets = registerProcessLevelSafetyNets(
      bindProcessErrorHandler(onUnhandledError),
    );
  }

  const processor = new DependencyProcessor(
    store,
    eventManager,
    taskRunner,
    logger,
    input.lifecycleMode,
    input.lazy,
    input.runtimeEventCycleDetection,
  );

  return {
    logger,
    store,
    eventManager,
    taskRunner,
    processor,
    onUnhandledError,
    unhookProcessSafetyNets,
  };
}
