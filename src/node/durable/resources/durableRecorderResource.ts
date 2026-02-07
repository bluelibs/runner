import { globals, r } from "../../../index";
import type { Store } from "../../../models/Store";
import type { ITask } from "../../../types/task";
import type { DependencyMapType } from "../../../types/utilities";
import { DurableResource } from "../core/DurableResource";
import { recordFlowShape, type DurableFlowShape } from "../core/flowShape";

export interface DurableRecorder {
  /**
   * Describe a durable workflow task using real runtime dependencies.
   *
   * - Non-durable deps are kept as-is (so pre-step control flow can use them).
   * - Durable deps are shimmed so `durable.use()` returns the recorder context.
   *
   * The task must be registered in the runtime store (ie. part of the app tree).
   */
  describe<I, O extends Promise<any>, D extends DependencyMapType>(
    task: ITask<I, O, D>,
    input?: I,
  ): Promise<DurableFlowShape>;
}

function injectRecorderIntoDurableDeps(
  deps: Record<string, unknown>,
  ctx: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...deps };
  for (const [key, value] of Object.entries(deps)) {
    if (value instanceof DurableResource) {
      next[key] = new Proxy(value, {
        get(target, prop, receiver) {
          if (prop === "use") {
            return () => ctx;
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    }
  }
  return next;
}

function getStoreTaskOrThrow(store: Store, taskId: string) {
  const storeTask = store.tasks.get(taskId);
  if (!storeTask) {
    throw new Error(
      `Cannot describe task "${taskId}": task is not registered in the runtime store.`,
    );
  }
  return storeTask;
}

/**
 * Resource that exposes a DI-accurate durable flow describer.
 *
 * Usage:
 * - `const recorder = durableRecorderResource.fork("app.durable.recorder");`
 * - Register it in your app root, then `runtime.getResourceValue(recorder).describe(task, input)`
 */
export const durableRecorderResource = r
  .resource<void>("base.durable.recorder")
  .dependencies({
    store: globals.resources.store,
  })
  .init(async (_config, { store }) => {
    return {
      describe: async <I, O extends Promise<any>, D extends DependencyMapType>(
        task: ITask<I, O, D>,
        input?: I,
      ) => {
        const storeTask = getStoreTaskOrThrow(store, task.id);
        const effectiveTask = storeTask.task as ITask<any, any, any>;
        const deps = storeTask.computedDependencies as Record<string, unknown>;

        return await recordFlowShape(async (ctx) => {
          const depsWithRecorder = injectRecorderIntoDurableDeps(deps, ctx);
          await effectiveTask.run(input as any, depsWithRecorder as any);
        });
      },
    };
  })
  .build();
