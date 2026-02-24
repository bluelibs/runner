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
  waitForShutdownGracePeriod,
} from "./tools/processShutdownHooks";
import { cancellationError } from "./errors";
import {
  OnUnhandledError,
  createDefaultUnhandledError,
  bindProcessErrorHandler,
} from "./models/UnhandledError";
import { RunResult } from "./models/RunResult";
import {
  ResourceLifecycleMode,
  ResourceInitMode,
  RunOptions,
} from "./types/runner";
import { getPlatform } from "./platform";

const activeRunResults = new Set<RunResult<any>>();

/**
 * This is the central function that kicks off your runner. You can run as many resources as you want in a single process, they will run in complete isolation.
 *
 * @param resourceOrResourceWithConfig - The resource or resource with config to run.
 * @param options - The options for the run.
 * @returns A promise that resolves to the result of the run.
 *
 * @example
 * ```ts
 * import { r, run } from "@bluelibs/runner";
 *
 * const app = r.resource("app")
 *   .register([myTask, myService])
 *   .build();
 *
 * const runtime = await run(app);
 * await runtime.runTask(myTask, { name: "Ada" });
 * await runtime.dispose();
 * ```
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
    shutdownGracePeriodMs = 30_000,
    dryRun = false,
    lazy = false,
    onUnhandledError: onUnhandledErrorOpt,
    runtimeEventCycleDetection = true,
    lifecycleMode,
    initMode,
  } = options || {};
  const normalizedLifecycleMode = normalizeResourceLifecycleMode(
    lifecycleMode,
    initMode,
  );

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
    normalizedLifecycleMode,
    lazy,
    runtimeEventCycleDetection,
  );

  // We may install shutdown hooks; capture unhook function to remove them on dispose
  let unhookShutdown: (() => void) | undefined;
  let bootstrapShutdownRequested = false;
  let disposeRequestedByShutdownSignal = false;
  let bootstrapCompleted = false;
  let bootstrapSucceeded = false;
  let resolveBootstrapCompletion!: () => void;
  const bootstrapCompletion = new Promise<void>((resolve) => {
    resolveBootstrapCompletion = resolve;
  });

  const requestBootstrapShutdown = () => {
    bootstrapShutdownRequested = true;
  };

  const throwIfBootstrapShutdownRequested = (phase: string) => {
    if (!bootstrapShutdownRequested) {
      return;
    }
    cancellationError.throw({
      reason: `Operation cancelled: shutdown requested during bootstrap (${phase}).`,
    });
  };

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
      activeRunResults.delete(runtimeResult);
      await store.dispose();
    }
  };
  // Ensure every runtime disposal path enters lockdown and drains in-flight
  // work before tearing down resource values.
  const emitLifecycleEvent = async (
    event: (typeof globalEvents)[keyof typeof globalEvents],
  ) => {
    await eventManager.emit(event, undefined, "run", {
      throwOnError: false,
      failureMode: "aggregate",
    });
  };

  const disposeAfterDraining = async () => {
    try {
      if (disposeRequestedByShutdownSignal) {
        await emitLifecycleEvent(globalEvents.shutdown);
      }

      await emitLifecycleEvent(globalEvents.disposing);
      const drained = await waitForShutdownGracePeriod(
        store,
        shutdownGracePeriodMs,
      );
      if (drained) {
        await emitLifecycleEvent(globalEvents.drained);
      }

      await disposeAll();
    } finally {
      disposeRequestedByShutdownSignal = false;
    }
  };
  const runtimeResult = new RunResult<any>(
    logger,
    store,
    eventManager,
    taskRunner,
    disposeAfterDraining,
  );

  if (shutdownHooks) {
    unhookShutdown = registerShutdownHook(async () => {
      disposeRequestedByShutdownSignal = true;
      if (!bootstrapCompleted) {
        requestBootstrapShutdown();
        await bootstrapCompletion;
        if (bootstrapSucceeded) {
          await runtimeResult.dispose();
        }
        return;
      }

      await runtimeResult.dispose();
    });
  }

  try {
    if (debug) {
      store.storeGenericItem(debugResource.with(debug));
    }

    // In the registration phase we register deeply all the resources, tasks, middleware and events
    store.initializeStore(resource, config, runtimeResult);
    throwIfBootstrapShutdownRequested("store initialization");

    // the overrides that were registered now will override the other registered resources
    await store.processOverrides();
    throwIfBootstrapShutdownRequested("override processing");

    store.validateDependencyGraph();
    // Compile-time event emission cycle detection (cheap, graph-based)
    store.validateEventEmissionGraph();

    const boundedLogger = logger.with({ source: "run" });
    if (dryRun) {
      await boundedLogger.debug("Dry run mode. Skipping initialization...");
      runtimeResult.setValue(store.root.value);
      return runtimeResult as RunResult<V extends Promise<infer U> ? U : V>;
    }

    // Beginning initialization
    await boundedLogger.debug("Events stored. Attaching listeners...");
    await processor.attachListeners();
    throwIfBootstrapShutdownRequested("listener attachment");
    await boundedLogger.debug("Listeners attached. Computing dependencies...");
    await processor.computeAllDependencies();
    throwIfBootstrapShutdownRequested("dependency computation");
    // After this stage, logger print policy could have been set.
    await boundedLogger.debug(
      "Dependencies computed. Proceeding with initialization...",
    );

    // Now we can safely compute dependencies without being afraid of an infinite loop.
    // The hooking part is done here.

    // Now we can initialise the root resource
    await processor.initializeRoot();
    throwIfBootstrapShutdownRequested("root initialization");

    const startupUnusedResourceIds = new Set<string>(
      Array.from(store.resources.values())
        .filter((resource) => !resource.isInitialized)
        .map((resource) => resource.resource.id),
    );

    // disallow manipulation or attaching more
    store.lock();
    eventManager.lock();
    await logger.lock();

    await eventManager.emit(globalEvents.ready, undefined, "run");

    await boundedLogger.info("Runner online. Awaiting tasks and events.");

    runtimeResult.setLazyOptions({
      lazyMode: lazy,
      startupUnusedResourceIds,
      lazyResourceLoader: async (resourceId: string) => {
        const resource = store.resources.get(resourceId)!.resource;
        return processor.extractResourceDependency(resource);
      },
    });
    runtimeResult.setValue(store.root.value);

    activeRunResults.add(runtimeResult);
    bootstrapSucceeded = true;

    return runtimeResult;
  } catch (err) {
    // Rollback initialized resources
    if (bootstrapShutdownRequested) {
      await disposeAfterDraining();
    } else {
      await disposeAll();
    }
    throw err;
  } finally {
    bootstrapCompleted = true;
    resolveBootstrapCompletion();
  }
}

export async function __disposeActiveRunResultsForTests(): Promise<void> {
  await __disposeActiveRunResultsForTestsExcept();
}

export function __snapshotActiveRunResultsForTests(): ReadonlySet<
  RunResult<any>
> {
  return new Set(activeRunResults);
}

export async function __disposeActiveRunResultsForTestsExcept(
  keep: ReadonlySet<RunResult<any>> = new Set(),
): Promise<void> {
  await Promise.all(
    Array.from(activeRunResults)
      .filter((runtime) => !keep.has(runtime))
      .map(async (runtime) => {
        try {
          await runtime.dispose();
        } catch {
          // Best-effort cleanup in tests; preserve original test failure surface.
        }
      }),
  );
}

// process hooks moved to processHooks.ts for clarity

function extractResourceAndConfig<C, V extends Promise<any>>(
  resourceOrResourceWithConfig:
    | IResourceWithConfig<C, V>
    | IResource<void, V, any, any> // For void configs
    | IResource<{ [K in any]?: any }, V, any, any>, // For optional config
) {
  let resource: IResource<any, any, any, any>;
  let config: unknown;
  if (isResourceWithConfig(resourceOrResourceWithConfig)) {
    resource = resourceOrResourceWithConfig.resource;
    config = resourceOrResourceWithConfig.config;
  } else {
    resource = resourceOrResourceWithConfig as IResource<any, any, any, any>;
    config = undefined;
  }
  return { resource, config };
}

function normalizeResourceLifecycleMode(
  lifecycleMode:
    | ResourceLifecycleMode
    | ResourceInitMode
    | "sequential"
    | "parallel"
    | undefined,
  initMode:
    | ResourceLifecycleMode
    | ResourceInitMode
    | "sequential"
    | "parallel"
    | undefined,
): ResourceLifecycleMode {
  const normalized = lifecycleMode ?? initMode;
  if (
    normalized === ResourceLifecycleMode.Parallel ||
    normalized === ResourceInitMode.Parallel
  ) {
    return ResourceLifecycleMode.Parallel;
  }
  return ResourceLifecycleMode.Sequential;
}
