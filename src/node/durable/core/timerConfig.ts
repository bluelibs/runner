import type { DurableServiceConfig } from "./interfaces/service";
import type { DurableTimerConfig } from "./interfaces/timers";

/** Field-wise fallback lets existing deployments migrate one setting at a time. */
export function resolveTimerConfig(
  config: Pick<DurableServiceConfig, "timers" | "polling">,
): DurableTimerConfig {
  return {
    enabled: config.timers?.enabled ?? config.polling?.enabled,
    pollIntervalMs: config.timers?.pollIntervalMs ?? config.polling?.interval,
    concurrency: config.timers?.concurrency ?? config.polling?.concurrency,
    claimTtlMs: config.timers?.claimTtlMs ?? config.polling?.claimTtlMs,
  };
}
