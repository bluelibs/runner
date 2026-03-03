import { r } from "../../../index";
import { disposeDurableService } from "./DurableService";
import { durableEventsArray } from "../events";
import type { RunnerDurableRuntimeConfig } from "./createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "./createRunnerDurableRuntime";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";

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
  .register([durableWorkflowTag, ...durableEventsArray])
  .dependencies({
    taskRunner: r.system.taskRunner,
    eventManager: r.system.eventManager,
    runnerStore: r.system.store,
    logger: r.runner.logger,
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
