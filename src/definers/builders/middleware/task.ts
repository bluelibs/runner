import type {
  DependencyMapType,
  ITask,
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  IValidationSchema,
  IMiddlewareMeta,
  TagType,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { defineTaskMiddleware } from "../../defineTaskMiddleware";
import type { TaskMiddlewareFluentBuilder } from "./task.interface";
import type { TaskMwState } from "./types";
import { cloneTask, mergeArray, mergeDependencies } from "./utils";

/**
 * Creates a TaskMiddlewareFluentBuilder from the given state.
 */
export function makeTaskMiddlewareBuilder<
  C,
  In,
  Out,
  D extends DependencyMapType,
>(
  state: TaskMwState<C, In, Out, D>,
): TaskMiddlewareFluentBuilder<C, In, Out, D> {
  const builder: TaskMiddlewareFluentBuilder<C, In, Out, D> = {
    id: state.id,

    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | ((config: C) => TNewDeps),
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const nextDependencies = mergeDependencies<C, D, TNewDeps>(
        state.dependencies as D | ((config: C) => D),
        deps,
        override,
      );

      const next = cloneTask<C, In, Out, D & TNewDeps>(state as any, {
        dependencies: nextDependencies as unknown as D & TNewDeps,
      });

      if (override) {
        return makeTaskMiddlewareBuilder<C, In, Out, TNewDeps>(
          next as unknown as TaskMwState<C, In, Out, TNewDeps>,
        );
      }
      return makeTaskMiddlewareBuilder<C, In, Out, D & TNewDeps>(next);
    },

    configSchema<TNew>(schema: IValidationSchema<TNew>) {
      const next = cloneTask<TNew, In, Out, D>(state as any, {
        configSchema: schema as any,
      });
      return makeTaskMiddlewareBuilder<TNew, In, Out, D>(next);
    },

    run(fn) {
      const next = cloneTask(state, { run: fn as any });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneTask(state, { meta: m as any });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneTask(state, {
        tags: mergeArray(state.tags, t, override) as TagType[],
      });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
    },

    everywhere(flag) {
      const next = cloneTask(state, { everywhere: flag });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
    },

    build() {
      const middleware = defineTaskMiddleware({
        ...(state as unknown as ITaskMiddlewareDefinition<C, In, Out, D>),
      });
      (middleware as { [symbolFilePath]?: string })[symbolFilePath] =
        state.filePath;
      return middleware;
    },
  };

  return builder;
}
