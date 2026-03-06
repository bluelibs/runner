import { r, resources } from "../../../index";
import { disposeDurableService } from "./DurableService";
import { durableEventsArray } from "../events";
import type { RunnerDurableRuntimeConfig } from "./createRunnerDurableRuntime";
import { createRunnerDurableRuntime } from "./createRunnerDurableRuntime";
import { durableWorkflowTag } from "../tags/durableWorkflow.tag";
import { createDurableResourceTemplate } from "../resources/createDurableResourceTemplate";

export type DurableResourceRuntimeConfig = RunnerDurableRuntimeConfig;

/**
 * A reusable durable resource template.
 *
 * Usage:
 * - `const durable = durableResource.define("app-durable");`
 * - Register it via `durable.with({ store, queue, eventBus, ... })`
 */
export const durableResource = createDurableResourceTemplate(
  r
    .resource<DurableResourceRuntimeConfig>("base-durable")
    .register([durableWorkflowTag, ...durableEventsArray])
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
    .build(),
);
