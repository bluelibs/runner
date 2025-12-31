import { globals, r } from "../../../index";
import type { DurableServiceConfig, DurableTask } from "./interfaces/service";
import { initDurableService, disposeDurableService } from "./DurableService";

export function createDurableServiceResource(config: DurableServiceConfig) {
  return r
    .resource<void>("durableService")
    .dependencies({ taskRunner: globals.resources.taskRunner })
    .init(async (_cfg, { taskRunner }) =>
      initDurableService({
        ...config,
        taskExecutor:
          config.taskExecutor ??
          ({
            run: async <TInput, TResult>(
              task: DurableTask<TInput, TResult>,
              input?: TInput,
            ) => {
              const outputPromise = await taskRunner.run(task, input);
              if (outputPromise === undefined) {
                throw new Error(
                  `Durable task '${task.id}' completed without a result promise.`,
                );
              }
              return await outputPromise;
            },
          } satisfies DurableServiceConfig["taskExecutor"]),
      }),
    )
    .dispose(async (service) => disposeDurableService(service, config))
    .build();
}
