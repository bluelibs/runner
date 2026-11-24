import { normalizeError } from "../../tools/normalizeError";
import type {
  DisposeWave,
  ResourceStoreElementType,
} from "../../types/storeTypes";
import { Logger } from "../Logger";

export { normalizeError as normalizeLifecycleError };

function collectWaveErrors(
  results: readonly PromiseSettledResult<void>[],
): Error[] {
  return results
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    .map((result) => normalizeError(result.reason));
}

/** Runs one lifecycle wave sequentially or concurrently and gathers errors. */
export async function executeLifecycleWave(
  wave: DisposeWave,
  action: (resource: ResourceStoreElementType) => Promise<void>,
): Promise<Error[]> {
  if (wave.parallel) {
    const results = await Promise.allSettled(
      wave.resources.map((resource) => action(resource)),
    );
    return collectWaveErrors(results);
  }

  const errors: Error[] = [];
  for (const resource of wave.resources) {
    try {
      await action(resource);
    } catch (error) {
      errors.push(normalizeError(error));
    }
  }

  return errors;
}

/** Runs `ready` hooks for one wave, awaiting started parallel hooks before throwing. */
export async function runReadyWave(
  wave: DisposeWave,
  runReadyResource: (resource: ResourceStoreElementType) => Promise<void>,
  options?: { shouldStop?: () => void },
): Promise<void> {
  if (wave.parallel) {
    const runningReadyPromises: Promise<void>[] = [];
    try {
      for (const resource of wave.resources) {
        options?.shouldStop?.();
        runningReadyPromises.push(runReadyResource(resource));
      }
    } catch (error) {
      if (runningReadyPromises.length > 0) {
        await Promise.allSettled(runningReadyPromises);
      }
      throw normalizeError(error);
    }

    const settledResults = await Promise.allSettled(runningReadyPromises);
    const rejectedResult = settledResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejectedResult) {
      throw normalizeError(rejectedResult.reason);
    }

    return;
  }

  for (const resource of wave.resources) {
    try {
      options?.shouldStop?.();
      await runReadyResource(resource);
    } catch (error) {
      throw normalizeError(error);
    }
  }
}

/** Logs non-fatal cooldown errors without interrupting shutdown progression. */
export async function logCooldownErrors(
  logger: Logger,
  errors: readonly Error[],
): Promise<void> {
  for (const error of errors) {
    try {
      await logger.warn("Resource cooldown failed; continuing shutdown.", {
        source: "store.cooldown",
        error,
      });
    } catch {
      // Logging must never promote cooldown failures into shutdown failures.
    }
  }
}
