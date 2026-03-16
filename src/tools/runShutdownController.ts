import { Logger } from "../models/Logger";
import { RunResult } from "../models/RunResult";
import type {
  DisposeRunArtifactsInput,
  ShutdownDisposalLifecycleInput,
} from "./shutdownDisposalLifecycle";
import {
  disposeRunArtifacts,
  runShutdownDisposalLifecycle,
} from "./shutdownDisposalLifecycle";
import { BootstrapCoordinator } from "./BootstrapCoordinator";
import { registerShutdownHook } from "./processShutdownHooks";
import { runtimeSource } from "../types/runtimeSource";
import {
  createRunDisposalSignalController,
  type RunDisposalSignalController,
} from "./runDisposalSignal";
import type { OnUnhandledError } from "../models/UnhandledError";

export type RunShutdownController = {
  readonly bootstrap: BootstrapCoordinator;
  assertNotAborted(): void;
  disposeAll(): Promise<void>;
  disposeWithShutdownLifecycle(): Promise<void>;
};

type CreateRunShutdownControllerInput = {
  store: ShutdownDisposalLifecycleInput["store"] &
    DisposeRunArtifactsInput["store"];
  eventManager: ShutdownDisposalLifecycleInput["eventManager"];
  logger: Logger;
  runtime: RunResult<unknown>;
  dispose: ShutdownDisposalLifecycleInput["dispose"];
  shutdownHooks: boolean;
  signal?: AbortSignal;
  onUnhandledError: OnUnhandledError;
  takeUnhookProcessSafetyNets: () => (() => void) | undefined;
  onBeforeDisposeAll: () => void;
};

/**
 * Owns bootstrap-aware shutdown wiring for a single run() invocation.
 * Keeps shutdown hooks, external signal disposal, and artifact cleanup out of run.ts.
 */
export function createRunShutdownController(
  input: CreateRunShutdownControllerInput,
): RunShutdownController {
  const bootstrap = new BootstrapCoordinator();
  let unhookShutdown: (() => void) | undefined;

  const runLifecycleSource = runtimeSource.runtime("runtime.lifecycle");
  const runLogger = input.logger.with({ source: "run" });
  const runDisposalSignal: RunDisposalSignalController =
    createRunDisposalSignalController({
      signal: input.signal,
      bootstrap,
      runtime: input.runtime,
      onUnhandledError: input.onUnhandledError,
    });

  const disposeAll = async () => {
    await disposeRunArtifacts({
      store: input.store,
      takeUnhookProcessSafetyNets: input.takeUnhookProcessSafetyNets,
      takeUnhookShutdown: () => {
        const current = unhookShutdown;
        unhookShutdown = undefined;
        return () => {
          // The outer signal is only a bootstrap/disposal trigger, so it should
          // stop observing as soon as this runtime finishes tearing down.
          runDisposalSignal.cleanup();
          current?.();
        };
      },
      onBeforeStoreDispose: input.onBeforeDisposeAll,
    });
  };

  const disposeWithShutdownLifecycle = async () =>
    runShutdownDisposalLifecycle({
      store: input.store,
      eventManager: input.eventManager,
      runLogger,
      runtimeLifecycleSource: runLifecycleSource,
      dispose: input.dispose,
      disposeAll,
    });

  if (input.shutdownHooks) {
    unhookShutdown = registerShutdownHook(async () => {
      if (!bootstrap.isCompleted) {
        // During bootstrap we cannot dispose yet because the runtime contract
        // is not fully available, so we request shutdown and let bootstrap
        // unwind through its own checkpoints first.
        bootstrap.requestShutdown();
        await bootstrap.completion;
        if (bootstrap.succeeded) {
          await input.runtime.dispose();
        }
        return;
      }

      await input.runtime.dispose();
    });
  }

  return {
    bootstrap,
    assertNotAborted() {
      runDisposalSignal.assertNotAborted();
    },
    disposeAll,
    disposeWithShutdownLifecycle,
  };
}
