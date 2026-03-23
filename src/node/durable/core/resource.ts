import { r, resources } from "../../../index";
import { disposeDurableService } from "./DurableService";
import type { RunnerDurableRuntimeConfig } from "./createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "./createRunnerDurableRuntime";
export type DurableResourceRuntimeConfig = RunnerDurableRuntimeConfig;

interface DurableResourceContext {
  runtimeConfig: RunnerDurableRuntimeConfig | null;
}

/**
 * A reusable durable resource template.
 *
 * Usage:
 * - `const durable = durableResource.fork("app-durable");`
 * - `const durable = resources.memoryWorkflow.fork("app-durable");`
 * - Register it via `durable.with({ store, queue, eventBus, ... })`
 * - For custom queue transports, use `roles: { queueConsumer: true }`
 *   to embed a worker in this process.
 */
export const durableResource = r
  .resource<DurableResourceRuntimeConfig>("base-durable")
  .dependencies({
    taskRunner: resources.taskRunner,
    eventManager: resources.eventManager,
    runnerStore: resources.store,
    logger: resources.logger,
  })
  .context<DurableResourceContext>(() => ({ runtimeConfig: null }))
  .init(
    async (
      config,
      { taskRunner, eventManager, runnerStore, logger },
      resourceContext,
    ) => {
      resourceContext.runtimeConfig = config;

      return await createRunnerDurableRuntime(config, {
        taskRunner,
        eventManager,
        runnerStore,
        logger,
      });
    },
  )
  .cooldown(async (durable) => {
    await durable.service.cooldown();
  })
  .dispose(async (durable, _config, _deps, resourceContext) => {
    if (!resourceContext.runtimeConfig) return;
    await disposeDurableService(durable.service, resourceContext.runtimeConfig);
  })
  .build();
