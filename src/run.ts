import { TaskRunner } from "./models/TaskRunner";
import { IResource, IResourceWithConfig } from "./defs";
import { DependencyProcessor } from "./models/DependencyProcessor";
import { EventManager } from "./models/EventManager";
import { globalEvents } from "./globals/globalEvents";
import { Store } from "./models/Store";
import { Logger } from "./models/Logger";
import { isResourceWithConfig } from "./define";
import { debugResource } from "./globals/resources/debug";
import {
  registerProcessLevelSafetyNets,
  registerShutdownHook,
} from "./tools/processShutdownHooks";
import {
  OnUnhandledError,
  createDefaultUnhandledError,
  bindProcessErrorHandler,
} from "./models/UnhandledError";
import { RunResult } from "./models/RunResult";
import { RunOptions } from "./types/runner";
import { getPlatform } from "./platform";

/**
 * This is the central function that kicks off you runner. You can run as many resources as you want in a single process, they will run in complete isolation.
 *
 * @param resourceOrResourceWithConfig - The resource or resource with config to run.
 * @param options - The options for the run.
 * @returns A promise that resolves to the result of the run.
 */
export async function run<C, V extends Promise<any>>(
  resourceOrResourceWithConfig:
    | IResourceWithConfig<C, V>
    | IResource<void, V, any, any> // For void configs
    | IResource<{ [K in any]?: any }, V, any, any>, // For optional config
  options?: RunOptions,
): Promise<RunResult<V extends Promise<infer U> ? U : V>> {
  // Import all necessary elements based on platform.
  await getPlatform().init();
  const {
    debug = undefined,
    logs = {},
    errorBoundary = true,
    shutdownHooks = true,
    dryRun = false,
    onUnhandledError: onUnhandledErrorOpt,
    runtimeEventCycleDetection = true,
  } = options || {};

  const {
    printThreshold = getPlatform().getEnv("NODE_ENV") === "test"
      ? null
      : "info",
    printStrategy = "pretty",
    bufferLogs = false,
  } = logs;

  const eventManager = new EventManager({
    runtimeEventCycleDetection,
  });

  const { resource, config } = extractResourceAndConfig(
    resourceOrResourceWithConfig,
  );

  // ensure for logger, that it can be used only after: computeAllDependencies() has executed
  const logger = new Logger({
    printThreshold,
    printStrategy,
    bufferLogs,
  });

  const onUnhandledError: OnUnhandledError =
    onUnhandledErrorOpt || createDefaultUnhandledError(logger);

  const store = new Store(eventManager, logger, onUnhandledError);
  const taskRunner = new TaskRunner(store, eventManager, logger);
  store.setTaskRunner(taskRunner);

  // Register this run's event manager for global process error safety nets
  let unhookProcessSafetyNets: (() => void) | undefined;
  if (errorBoundary) {
    unhookProcessSafetyNets = registerProcessLevelSafetyNets(
      bindProcessErrorHandler(onUnhandledError),
    );
  }

  const processor = new DependencyProcessor(
    store,
    eventManager,
    taskRunner,
    logger,
  );

  // We may install shutdown hooks; capture unhook function to remove them on dispose
  let unhookShutdown: (() => void) | undefined;

  // Helper dispose that always unhooks process listeners first
  const disposeAll = async () => {
    try {
      if (unhookProcessSafetyNets) {
        unhookProcessSafetyNets();
        unhookProcessSafetyNets = undefined;
      }
      if (unhookShutdown) {
        unhookShutdown();
        unhookShutdown = undefined;
      }
    } finally {
      await store.dispose();
    }
  };

  try {
    if (debug) {
      store.storeGenericItem(debugResource.with(debug));
    }

    // In the registration phase we register deeply all the resources, tasks, middleware and events
    store.initializeStore(resource, config);

    // the overrides that were registered now will override the other registered resources
    await store.processOverrides();

    store.validateDependencyGraph();
    // Compile-time event emission cycle detection (cheap, graph-based)
    store.validateEventEmissionGraph();

    const boundedLogger = logger.with({ source: "run" });
    if (dryRun) {
      await boundedLogger.debug("Dry run mode. Skipping initialization...");
      return new RunResult(
        store.root.value,
        logger,
        store,
        eventManager,
        taskRunner,
        disposeAll,
      );
    }

    // Beginning initialization
    await boundedLogger.debug("Events stored. Attaching listeners...");
    await processor.attachListeners();
    await boundedLogger.debug("Listeners attached. Computing dependencies...");
    await processor.computeAllDependencies();
    // After this stage, logger print policy could have been set.
    await boundedLogger.debug(
      "Dependencies computed. Proceeding with initialization...",
    );

    // Now we can safely compute dependencies without being afraid of an infinite loop.
    // The hooking part is done here.

    // Now we can initialise the root resource
    await processor.initializeRoot();

    // disallow manipulation or attaching more
    store.lock();
    eventManager.lock();
    await logger.lock();

    await eventManager.emit(globalEvents.ready, undefined, "run");

    await boundedLogger.info("Runner online. Awaiting tasks and events.");

    if (shutdownHooks) {
      unhookShutdown = registerShutdownHook(() => store.dispose());
    }

    return new RunResult(
      store.root.value,
      logger,
      store,
      eventManager,
      taskRunner,
      disposeAll,
    );
  } catch (err) {
    // Rollback initialized resources
    await disposeAll();
    throw err;
  }
}

// process hooks moved to processHooks.ts for clarity

function extractResourceAndConfig<C, V extends Promise<any>>(
  resourceOrResourceWithConfig:
    | IResourceWithConfig<C, V>
    | IResource<void, V, any, any> // For void configs
    | IResource<{ [K in any]?: any }, V, any, any>, // For optional config
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
