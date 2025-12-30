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
              const out = await taskRunner.run(task, input);
              return out === undefined ? undefined : await out;
            },
          } satisfies DurableServiceConfig["taskExecutor"]),
      }),
    )
    .dispose(async (service) => disposeDurableService(service, config))
    .build();
}
