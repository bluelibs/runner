import { IResource, IResourceWithConfig } from "./defs";
import { globalEvents } from "./globals/globalEvents";
import { registerShutdownHook } from "./tools/processShutdownHooks";
import { RunResult } from "./models/RunResult";
import {
  ResolvedRunOptions,
  ResourceLifecycleMode,
  RunOptions,
} from "./types/runner";
import { getPlatform } from "./platform";
import { runtimeSource } from "./types/runtimeSource";
import {
  disposeRunArtifacts,
  DisposeRunArtifactsInput,
  runShutdownDisposalLifecycle,
} from "./tools/shutdownDisposalLifecycle";
import { BootstrapCoordinator } from "./tools/BootstrapCoordinator";
import { createRuntimeServices } from "./tools/createRuntimeServices";
import { extractResourceAndConfig } from "./tools/extractResourceAndConfig";
import { resolveExecutionContextConfig } from "./tools/resolveExecutionContextConfig";
import { detectRunnerMode } from "./tools/detectRunnerMode";
import { runRootGatewayUnsupportedError } from "./errors";

const activeRunResults = new Set<RunResult<any>>();

function normalizeRunOptions(options: RunOptions | undefined): Omit<
  ResolvedRunOptions,
  "onUnhandledError"
> & {
  onUnhandledErrorInput?: ResolvedRunOptions["onUnhandledError"];
} {
  const debug = options?.debug;
  const errorBoundary = options?.errorBoundary ?? true;
  const shutdownHooks = options?.shutdownHooks ?? true;
  const disposeBudgetMs = options?.disposeBudgetMs ?? 30_000;
  const disposeDrainBudgetMs = options?.disposeDrainBudgetMs ?? 30_000;
  const dryRun = options?.dryRun ?? false;
  const lazy = options?.lazy ?? false;
  const executionContext = resolveExecutionContextConfig(
    options?.executionContext,
  );
  const lifecycleMode =
    options?.lifecycleMode === ResourceLifecycleMode.Parallel
      ? ResourceLifecycleMode.Parallel
      : ResourceLifecycleMode.Sequential;
  const mode = detectRunnerMode(options?.mode);
  const logs = {
    printThreshold:
      options?.logs?.printThreshold ??
      (getPlatform().getEnv("NODE_ENV") === "test" ? null : "info"),
    printStrategy: options?.logs?.printStrategy ?? "pretty",
    bufferLogs: options?.logs?.bufferLogs ?? false,
  };

  return {
    debug,
    logs: Object.freeze(logs),
    errorBoundary,
    shutdownHooks,
    disposeBudgetMs,
    disposeDrainBudgetMs,
    onUnhandledErrorInput: options?.onUnhandledError,
    dryRun,
    executionContext:
      executionContext === null
        ? null
        : Object.freeze({
            ...executionContext,
            cycleDetection:
              executionContext.cycleDetection === null
                ? null
                : Object.freeze({ ...executionContext.cycleDetection }),
          }),
    lazy,
    lifecycleMode,
    mode,
  };
}

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

  // --- Service creation ---
  const { resource, config } = extractResourceAndConfig(
    resourceOrResourceWithConfig,
  );
  if (resource.gateway === true) {
    runRootGatewayUnsupportedError.throw({ id: resource.id });
  }

  const services = createRuntimeServices({
    mode: normalizedOptions.mode,
    lifecycleMode: normalizedOptions.lifecycleMode,
    executionContextConfig: normalizedOptions.executionContext,
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
  let { unhookProcessSafetyNets } = services;

  // --- Bootstrap coordination ---
  const bootstrap = new BootstrapCoordinator();
  let unhookShutdown: (() => void) | undefined;

  const disposeAll = async (
    disposalBudget?: DisposeRunArtifactsInput["disposalBudget"],
  ) => {
    await disposeRunArtifacts({
      store,
      disposalBudget,
      takeUnhookProcessSafetyNets: () => {
        const current = unhookProcessSafetyNets;
        unhookProcessSafetyNets = undefined;
        return current;
      },
      takeUnhookShutdown: () => {
        const current = unhookShutdown;
        unhookShutdown = undefined;
        return current;
      },
      onBeforeStoreDispose: () => {
        activeRunResults.delete(runtimeResult);
      },
    });
  };

  const runtimeLifecycleSource = runtimeSource.runtime("runtime.lifecycle");
  const runLogger = logger.with({ source: "run" });

  const disposeWithShutdownLifecycle = async () =>
    runShutdownDisposalLifecycle({
      store,
      eventManager,
      runLogger,
      runtimeLifecycleSource,
      disposeBudgetMs: normalizedOptions.disposeBudgetMs,
      disposeDrainBudgetMs: normalizedOptions.disposeDrainBudgetMs,
      disposeAll,
    });

  const runtimeResult = new RunResult<any>(
    logger,
    store,
    eventManager,
    taskRunner,
    runOptions,
    disposeWithShutdownLifecycle,
  );

  if (normalizedOptions.shutdownHooks) {
    unhookShutdown = registerShutdownHook(async () => {
      if (!bootstrap.isCompleted) {
        bootstrap.requestShutdown();
        await bootstrap.completion;
        if (bootstrap.succeeded) {
          await runtimeResult.dispose();
        }
        return;
      }

      await runtimeResult.dispose();
    });
  }

  // --- Bootstrap sequence ---
  try {
    store.initializeStore(resource, config, runtimeResult, {
      debug: normalizedOptions.debug,
    });
    bootstrap.throwIfShutdownRequested("store initialization");

    await store.processOverrides();
    bootstrap.throwIfShutdownRequested("override processing");

    store.validateDependencyGraph();
    store.validateEventEmissionGraph();

    if (normalizedOptions.dryRun) {
      await runLogger.debug("Dry run mode. Skipping initialization...");
      runtimeResult.setValue(store.root.value);
      return runtimeResult as RunResult<V extends Promise<infer U> ? U : V>;
    }

    await runLogger.debug("Events stored. Attaching listeners...");
    await processor.attachListeners();
    bootstrap.throwIfShutdownRequested("listener attachment");

    await runLogger.debug("Listeners attached. Computing dependencies...");
    await processor.computeAllDependencies();
    bootstrap.throwIfShutdownRequested("dependency computation");

    await runLogger.debug(
      "Dependencies computed. Proceeding with initialization...",
    );

    await processor.initializeRoot();
    bootstrap.throwIfShutdownRequested("root initialization");

    const startupUnusedResourceIds = new Set<string>(
      Array.from(store.resources.values())
        .filter((entry) => !entry.isInitialized)
        .map((entry) => entry.resource.id),
    );

    store.lock();
    eventManager.lock();
    await logger.lock();
    await store.ready();

    await eventManager.emit(
      globalEvents.ready,
      undefined,
      runtimeLifecycleSource,
    );

    await runLogger.info("Runner online. Awaiting tasks and events.");

    runtimeResult.setLazyOptions({
      lazyMode: normalizedOptions.lazy,
      startupUnusedResourceIds,
      lazyResourceLoader: async (resourceId: string) => {
        const res = store.resources.get(resourceId)!.resource;
        return processor.extractResourceDependency(res);
      },
    });
    runtimeResult.setValue(store.root.value);

    activeRunResults.add(runtimeResult);
    bootstrap.markCompleted(true);

    return runtimeResult;
  } catch (err) {
    if (bootstrap.wasShutdownRequested) {
      await disposeWithShutdownLifecycle();
    } else {
      await disposeAll();
    }
    throw err;
  } finally {
    if (!bootstrap.isCompleted) {
      bootstrap.markCompleted(false);
    }
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
