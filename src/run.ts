import { TaskRunner } from "./models/TaskRunner";
import {
  DependencyMapType,
  ITaskDefinition,
  IResourceDefinition,
  IEventDefinition,
  IMiddlewareDefinition,
  DependencyValuesType,
  IResource,
  IResourceWithConfig,
} from "./defs";
import { DependencyProcessor } from "./models/DependencyProcessor";
import { EventManager } from "./models/EventManager";
import { globalEvents } from "./globals/globalEvents";
import { Store } from "./models/Store";
import { findCircularDependencies } from "./tools/findCircularDependencies";
import { CircularDependenciesError } from "./errors";
import { globalResources } from "./globals/globalResources";
import { Logger, LogLevels, PrintStrategy } from "./models/Logger";
import { isResourceWithConfig } from "./define";
import { debugResource, DebugFriendlyConfig } from "./globals/resources/debug";
import {
  registerProcessLevelSafetyNets,
  registerShutdownHook,
} from "./processHooks";
import {
  OnUnhandledError,
  defaultUnhandledError,
  bindProcessErrorHandler,
  safeReportUnhandledError,
} from "./models/UnhandledError";

export type RunOptions = {
  /**
   * Defaults to undefined. If true, we introduce logging to the console.
   */
  debug?: DebugFriendlyConfig;
  logs?: {
    /**
     * Defaults to info. Use null to disable logging.
     */
    printThreshold?: null | LogLevels;
    /**
     * Defaults to PRETTY. How to print the logs.
     */
    printStrategy?: PrintStrategy;
    /**
     * Defaults to false. If true, we buffer logs until the root resource is ready.
     * This provides you with the chance to see the logs before the root resource is ready.
     */
    bufferLogs?: boolean;
  };
  /**
   * When true (default), installs a central error boundary that catches uncaught errors
   * from process-level events and routes them to `onUnhandledError`.
   */
  errorBoundary?: boolean;
  /**
   * When true (default), installs SIGINT/SIGTERM handlers that call dispose() on the root.
   */
  shutdownHooks?: boolean;
  /**
   * Custom handler for any unhandled error caught by Runner. Defaults to logging via the created logger.
   */
  onUnhandledError?: OnUnhandledError;
};

export async function run<C, V extends Promise<any>>(
  resourceOrResourceWithConfig:
    | IResourceWithConfig<C, V>
    | IResource<void, V, any, any> // For void configs
    | IResource<{ [K in any]?: any }, V, any, any>, // For optional config
  options?: RunOptions
): Promise<{
  value: V extends Promise<infer U> ? U : V;
  store: Store;
  dispose: () => Promise<void>;
  /** This is used to run tasks. */
  taskRunner: TaskRunner;
  eventManager: EventManager;
}> {
  const {
    debug = undefined,
    logs = {},
    errorBoundary = true,
    shutdownHooks = true,
    onUnhandledError: onUnhandledErrorOpt,
  } = options || {};
  const {
    printThreshold = "info",
    printStrategy = "pretty",
    bufferLogs = false,
  } = logs;

  const eventManager = new EventManager();
  let { resource, config } = extractResourceAndConfig(
    resourceOrResourceWithConfig
  );

  // ensure for logger, that it can be used only after: computeAllDependencies() has executed
  const logger = new Logger({
    printThreshold,
    printStrategy,
    bufferLogs,
  });

  const onUnhandledError: OnUnhandledError =
    onUnhandledErrorOpt || defaultUnhandledError;

  const store = new Store(eventManager, logger);
  const taskRunner = new TaskRunner(
    store,
    eventManager,
    logger,
    onUnhandledError
  );
  store.setTaskRunner(taskRunner);

  // Register this run's event manager for global process error safety nets
  let unhookProcessSafetyNets: (() => void) | undefined;
  if (errorBoundary) {
    unhookProcessSafetyNets = registerProcessLevelSafetyNets(
      bindProcessErrorHandler(onUnhandledError, logger)
    );
  }

  const processor = new DependencyProcessor(
    store,
    eventManager,
    taskRunner,
    logger,
    onUnhandledError
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
    // In the registration phase we register deeply all the resources, tasks, middleware and events
    store.initializeStore(resource, config);

    if (debug) {
      store.storeGenericItem(debugResource.with(debug));
    }

    // We verify that there isn't any circular dependencies before we begin computing the dependencies
    const dependentNodes = store.getDependentNodes();
    const circularDependencies = findCircularDependencies(dependentNodes);
    if (circularDependencies.cycles.length > 0) {
      throw new CircularDependenciesError(circularDependencies.cycles);
    }

    // the overrides that were registered now will override the other registered resources
    await store.processOverrides();

    // a form of hooking, we create the events for all tasks and store them so they can be referenced
    await store.storeEventsForAllTRM();
    await logger.debug("Events stored. Attaching listeners...");
    await processor.attachListeners();
    await logger.debug("Listeners attached. Computing dependencies...");
    await processor.computeAllDependencies();
    // After this stage, logger print policy could have been set.
    await logger.debug(
      "Dependencies computed. Proceeding with initialization..."
    );

    // Now we can safely compute dependencies without being afraid of an infinite loop.
    // The hooking part is done here.

    // Now we can initialise the root resource
    await processor.initializeRoot();

    await logger.debug("System initialized and operational.");

    // disallow manipulation or attaching more
    store.lock();
    eventManager.lock();
    await logger.lock();

    await eventManager.emit(
      globalEvents.ready,
      {
        root: store.root.resource,
      },
      "system"
    );

    if (shutdownHooks) {
      unhookShutdown = registerShutdownHook(() => store.dispose());
    }

    return {
      value: store.root.value,
      dispose: disposeAll,
      store,
      taskRunner,
      eventManager,
    };
  } catch (err) {
    // Rollback initialized resources
    await disposeAll();
    await safeReportUnhandledError(onUnhandledError, logger, err);
    throw err;
  }
}

// process hooks moved to processHooks.ts for clarity

function extractResourceAndConfig<C, V extends Promise<any>>(
  resourceOrResourceWithConfig:
    | IResourceWithConfig<C, V>
    | IResource<void, V, any, any> // For void configs
    | IResource<{ [K in any]?: any }, V, any, any> // For optional config
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
