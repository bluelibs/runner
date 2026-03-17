import { IResource, IResourceWithConfig } from "./defs";
import { globalEvents } from "./globals/globalEvents";
import { RunResult } from "./models/RunResult";
import { ResolvedRunOptions, RunOptions } from "./types/runner";
import { getPlatform } from "./platform";
import {
  registerActiveRunResult,
  unregisterActiveRunResult,
} from "./runtime/activeRunResults";
import { runtimeSource } from "./types/runtimeSource";
import { assertExecutionContextSupport } from "./tools/assertExecutionContextSupport";
import { createRuntimeServices } from "./tools/createRuntimeServices";
import { extractResourceAndConfig } from "./tools/extractResourceAndConfig";
import { normalizeRunOptions } from "./tools/normalizeRunOptions";
import {
  createRunShutdownController,
  type RunShutdownController,
} from "./tools/runShutdownController";

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
  await getPlatform().init();
  const normalizedOptions = normalizeRunOptions(options);
  assertExecutionContextSupport(normalizedOptions.executionContext);

  // --- Service creation ---
  const { resource, config } = extractResourceAndConfig(
    resourceOrResourceWithConfig,
  );

  const services = createRuntimeServices({
    mode: normalizedOptions.mode,
    lifecycleMode: normalizedOptions.lifecycleMode,
    lazy: normalizedOptions.lazy,
    errorBoundary: normalizedOptions.errorBoundary,
    onUnhandledError: normalizedOptions.onUnhandledErrorInput,
    printThreshold: normalizedOptions.logs.printThreshold,
    printStrategy: normalizedOptions.logs.printStrategy,
    bufferLogs: normalizedOptions.logs.bufferLogs,
  });

  const { logger, store, eventManager, processor, taskRunner } = services;
  const { onUnhandledErrorInput: _onUnhandledErrorInput, ...publicRunOptions } =
    normalizedOptions;
  const runOptions: ResolvedRunOptions = Object.freeze({
    ...publicRunOptions,
    onUnhandledError: services.onUnhandledError,
  });
  const runLogger = logger.with({ source: "run" });
  const runtimeLifecycleSource = runtimeSource.runtime("runtime.lifecycle");
  let { unhookProcessSafetyNets } = services;
  const runtimeResult = new RunResult<any>(
    logger,
    store,
    eventManager,
    taskRunner,
    runOptions,
    () => shutdownController.disposeWithShutdownLifecycle(),
    () => shutdownController.requestForceDispose(),
  );
  const shutdownController: RunShutdownController = createRunShutdownController(
    {
      store,
      eventManager,
      logger,
      runtime: runtimeResult,
      dispose: normalizedOptions.dispose,
      shutdownHooks: normalizedOptions.shutdownHooks,
      signal: normalizedOptions.signal,
      onUnhandledError: services.onUnhandledError,
      takeUnhookProcessSafetyNets: () => {
        const current = unhookProcessSafetyNets;
        unhookProcessSafetyNets = undefined;
        return current;
      },
      onBeforeDisposeAll: () => {
        unregisterActiveRunResult(runtimeResult);
      },
    },
  );

  // --- Bootstrap sequence ---
  try {
    const throwIfShutdownRequested = (phase: string): void => {
      shutdownController.bootstrap.throwIfShutdownRequested(phase);
    };
    const throwIfReadyHooksShutdownRequested = (): void => {
      throwIfShutdownRequested("resource ready hooks");
    };

    shutdownController.assertNotAborted();
    store.initializeStore(resource, config, runtimeResult, {
      debug: normalizedOptions.debug,
      executionContext: normalizedOptions.executionContext,
    });
    throwIfShutdownRequested("store initialization");

    await store.processOverrides();
    throwIfShutdownRequested("override processing");

    store.validateDependencyGraph();
    store.validateEventEmissionGraph();

    if (normalizedOptions.dryRun) {
      await runLogger.debug("Dry run mode. Skipping initialization...");
      runtimeResult.setValue(store.root.value);
      shutdownController.bootstrap.markCompleted(true);
      return runtimeResult as RunResult<V extends Promise<infer U> ? U : V>;
    }

    await runLogger.debug("Events stored. Attaching listeners...");
    await processor.attachListeners();
    throwIfShutdownRequested("listener attachment");

    await runLogger.debug("Listeners attached. Computing dependencies...");
    await processor.computeAllDependencies();
    throwIfShutdownRequested("dependency computation");

    await runLogger.debug(
      "Dependencies computed. Proceeding with initialization...",
    );

    await processor.initializeRoot();
    throwIfShutdownRequested("root initialization");

    const startupUnusedResourceIds = new Set<string>(
      Array.from(store.resources.values())
        .filter((entry) => !entry.isInitialized)
        .map((entry) => entry.resource.id),
    );

    store.lock();
    eventManager.lock();
    await logger.lock();
    throwIfShutdownRequested("logger lock");

    await store.ready({
      shouldStop: throwIfReadyHooksShutdownRequested,
    });
    throwIfReadyHooksShutdownRequested();

    await shutdownController.bootstrap.withPhaseSignal(
      "ready event",
      async (signal) =>
        eventManager.emit(
          store.resolveRegisteredDefinition(globalEvents.ready),
          undefined,
          {
            source: runtimeLifecycleSource,
            signal,
          },
        ),
    );
    throwIfShutdownRequested("ready event");

    await runLogger.info("Runner online. Awaiting tasks and events.");
    throwIfShutdownRequested("startup finalization");

    runtimeResult.setLazyOptions({
      lazyMode: normalizedOptions.lazy,
      startupUnusedResourceIds,
      lazyResourceLoader: async (resourceId: string) => {
        const res = store.resources.get(resourceId)!.resource;
        return processor.extractResourceDependency(res);
      },
    });
    runtimeResult.setValue(store.root.value);

    registerActiveRunResult(runtimeResult);
    shutdownController.bootstrap.markCompleted(true);

    return runtimeResult;
  } catch (err) {
    if (shutdownController.bootstrap.wasShutdownRequested) {
      await shutdownController.disposeWithShutdownLifecycle();
    } else {
      await shutdownController.disposeAll();
    }
    throw err;
  } finally {
    if (!shutdownController.bootstrap.isCompleted) {
      shutdownController.bootstrap.markCompleted(false);
    }
  }
}
