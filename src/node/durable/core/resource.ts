import { globals, r } from "../../../index";
import { disposeDurableService } from "./DurableService";
import { durableEventsArray } from "../events";
import type { RunnerDurableRuntimeConfig } from "./createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "./createRunnerDurableRuntime";

export type DurableResourceRuntimeConfig = RunnerDurableRuntimeConfig;

/**
 * A reusable durable resource template.
 *
 * Usage:
 * - `const durable = durableResource.fork("app.durable");`
 * - Register it via `durable.with({ store, queue, eventBus, ... })`
 */
export const durableResource = r
  .resource<DurableResourceRuntimeConfig>("base.durable")
  .register(durableEventsArray)
  .dependencies({
    taskRunner: globals.resources.taskRunner,
    eventManager: globals.resources.eventManager,
    runnerStore: globals.resources.store,
  })
  .init(async (config, { taskRunner, eventManager, runnerStore }) => {
    return await createRunnerDurableRuntime(config, {
      taskRunner,
      eventManager,
      runnerStore,
    });
  })
  .dispose(async (durable, config) =>
    disposeDurableService(durable.service, config),
  )
  .build();
