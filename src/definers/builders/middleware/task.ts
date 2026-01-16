import type {
  DependencyMapType,
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

      const next = cloneTask<C, In, Out, D & TNewDeps>(
        state as unknown as TaskMwState<C, In, Out, D & TNewDeps>,
        {
          dependencies: nextDependencies as unknown as D & TNewDeps,
        },
      );

      if (override) {
        return makeTaskMiddlewareBuilder<C, In, Out, TNewDeps>(
          next as unknown as TaskMwState<C, In, Out, TNewDeps>,
        );
      }
      return makeTaskMiddlewareBuilder<C, In, Out, D & TNewDeps>(next);
    },

    configSchema<TNew>(schema: IValidationSchema<TNew>) {
      const next = cloneTask<TNew, In, Out, D>(
        state as unknown as TaskMwState<TNew, In, Out, D>,
        {
          configSchema: schema as unknown as TaskMwState<TNew, In, Out, D>["configSchema"],
        },
      );
      return makeTaskMiddlewareBuilder<TNew, In, Out, D>(next);
    },

    run(fn) {
      const next = cloneTask(state, { run: fn as typeof state.run });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneTask(state, { meta: m as IMiddlewareMeta });
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
