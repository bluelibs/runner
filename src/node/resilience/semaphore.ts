import { check, Match } from "../../tools/check";
import { concurrencyWaitPatterns } from "../../globals/middleware/concurrency/wait";
import { sharedConcurrencyKey } from "../../globals/resilience/concurrencyKey";
import type {
  Resilience,
  ResilienceSemaphore,
  ResilienceSemaphoreConfig,
} from "../../globals/resilience/types";

/** A handle owns configuration only; the backend owns permits, waiters, and shutdown. */
export function createResilienceSemaphore(
  backend: Pick<Resilience, "withPermit">,
  config: ResilienceSemaphoreConfig,
): ResilienceSemaphore {
  check(config, {
    key: Match.NonEmptyString,
    limit: Match.Where(
      (value: unknown): value is number =>
        typeof value === "number" && Number.isSafeInteger(value) && value > 0,
    ),
    ...concurrencyWaitPatterns,
  });
  // Snapshot caller-owned options so a live handle cannot change its pool policy.
  const { key, limit, maxQueue, waitTimeoutMs } = config;
  const identity = sharedConcurrencyKey(key);
  return Object.freeze<ResilienceSemaphore>({
    withPermit(run, options) {
      const controller = new AbortController();
      const signal = options?.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
      return backend.withPermit(
        identity,
        limit,
        signal,
        (reason) => controller.abort(reason),
        () => run(signal),
        { maxQueue, waitTimeoutMs },
      );
    },
  });
}
