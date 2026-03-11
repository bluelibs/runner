import { r, resources } from "../../../index";
import { disposeDurableService } from "./DurableService";
import type { RunnerDurableRuntimeConfig } from "./createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "./createRunnerDurableRuntime";

export type DurableResourceRuntimeConfig = RunnerDurableRuntimeConfig;

/**
 * A reusable durable resource template.
 *
 * Usage:
 * - `const durable = durableResource.fork("app-durable");`
 * - `const durable = resources.memoryWorkflow.fork("app-durable");`
 * - Register it via `durable.with({ store, queue, eventBus, ... })`
 */
export const durableResource = r
  .resource<DurableResourceRuntimeConfig>("base-durable")
  .dependencies({
    taskRunner: resources.taskRunner,
    eventManager: resources.eventManager,
    runnerStore: resources.store,
    logger: resources.logger,
  })
  .init(async (config, { taskRunner, eventManager, runnerStore, logger }) => {
    return await createRunnerDurableRuntime(config, {
      taskRunner,
      eventManager,
      runnerStore,
      logger,
    });
  })
  .dispose(async (durable, config) =>
    disposeDurableService(durable.service, config),
  )
  .build();
