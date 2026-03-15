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
  runShutdownDisposalLifecycle,
} from "./tools/shutdownDisposalLifecycle";
import { BootstrapCoordinator } from "./tools/BootstrapCoordinator";
import { createRuntimeServices } from "./tools/createRuntimeServices";
import { extractResourceAndConfig } from "./tools/extractResourceAndConfig";
import { detectRunnerMode } from "./tools/detectRunnerMode";
import { resolveExecutionContextConfig } from "./tools/resolveExecutionContextConfig";

function resolveRegisteredEvent<TInput>(
  store: {
    findIdByDefinition(reference: unknown): string;
    findDefinitionById(id: string): unknown;
  },
  eventDefinition: { id: string },
): TInput {
  const canonicalId = store.findIdByDefinition(eventDefinition);
  return store.findDefinitionById(canonicalId) as TInput;
}

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
  const dispose = Object.freeze({
    totalBudgetMs: options?.dispose?.totalBudgetMs ?? 30_000,
    drainingBudgetMs: options?.dispose?.drainingBudgetMs ?? 20_000,
    cooldownWindowMs: options?.dispose?.cooldownWindowMs ?? 0,
  });
  const dryRun = options?.dryRun ?? false;
  const lazy = options?.lazy ?? false;
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
    dispose,
    onUnhandledErrorInput: options?.onUnhandledError,
    dryRun,
    executionContext: resolveExecutionContextConfig(options?.executionContext),
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
  let { unhookProcessSafetyNets } = services;

  // --- Bootstrap coordination ---
  const bootstrap = new BootstrapCoordinator();
  let unhookShutdown: (() => void) | undefined;

  const disposeAll = async () => {
    await disposeRunArtifacts({
      store,
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
      dispose: normalizedOptions.dispose,
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
      executionContext: normalizedOptions.executionContext,
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
      resolveRegisteredEvent<typeof globalEvents.ready>(
        store,
        globalEvents.ready,
      ),
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
