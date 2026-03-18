import { RunResult } from "../models/RunResult";
import {
  OnUnhandledError,
  safeReportUnhandledError,
} from "../models/UnhandledError";
import { BootstrapCoordinator } from "./BootstrapCoordinator";
import {
  getAbortSignalReason,
  throwCancellationErrorFromSignal,
} from "./abortSignals";

export type RunDisposalSignalController = {
  assertNotAborted(): void;
  cleanup(): void;
};

type CreateRunDisposalSignalControllerInput = {
  signal?: AbortSignal;
  bootstrap: BootstrapCoordinator;
  runtime: RunResult<unknown>;
  onUnhandledError: OnUnhandledError;
};

/**
 * Bridges an outer AbortSignal into the runtime shutdown lifecycle.
 * This stays at the run() boundary and never participates in ambient execution context.
 */
export function createRunDisposalSignalController(
  input: CreateRunDisposalSignalControllerInput,
): RunDisposalSignalController {
  const { signal, bootstrap, runtime, onUnhandledError } = input;

  if (!signal) {
    return {
      assertNotAborted() {},
      cleanup() {},
    };
  }

  const disposeFromSignal = async () => {
    if (!bootstrap.isCompleted) {
      // Abort is allowed to stop startup, but startup still owns rollback while
      // bootstrap is in flight. Waiting here avoids racing a half-built runtime
      // with disposal logic that expects bootstrap to have settled.
      bootstrap.requestShutdown(
        getAbortSignalReason(signal, "run() disposal signal aborted"),
      );
      await bootstrap.completion;
      if (!bootstrap.succeeded) {
        return;
      }
    }

    await runtime.dispose();
  };

  const onAbort = () => {
    void disposeFromSignal().catch((error) =>
      safeReportUnhandledError(onUnhandledError, {
        error,
        kind: "run",
        source: "run.signal",
      }),
    );
  };

  signal.addEventListener("abort", onAbort, { once: true });

  return {
    assertNotAborted() {
      if (signal.aborted) {
        throwCancellationErrorFromSignal(
          signal,
          "run() disposal signal aborted",
        );
      }
    },
    cleanup() {
      // removeEventListener is still worth doing even with { once: true } so a
      // long-lived, never-aborted signal does not retain this runtime instance.
      signal.removeEventListener("abort", onAbort);
    },
  };
}
