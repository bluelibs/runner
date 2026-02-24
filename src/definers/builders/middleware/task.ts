import type {
  DependencyMapType,
  EnsureTagsForTarget,
  ITaskMiddlewareDefinition,
  IValidationSchema,
  IMiddlewareMeta,
  TaskMiddlewareTagType,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import type { ThrowsList } from "../../../types/error";
import { builderIncompleteError } from "../../../errors";
import { defineTaskMiddleware } from "../../defineTaskMiddleware";
import type {
  TaskMiddlewareFluentBuilder,
  TaskMiddlewareFluentBuilderAfterRun,
  TaskMiddlewareFluentBuilderBeforeRun,
} from "./task.interface";
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
  THasRun extends boolean = false,
>(
  state: TaskMwState<C, In, Out, D>,
): TaskMiddlewareFluentBuilder<C, In, Out, D, THasRun> {
  const builder = {
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

      const next = cloneTask<C, In, Out, D, C, In, Out, D & TNewDeps>(state, {
        dependencies: nextDependencies as D & TNewDeps,
      });

      if (override) {
        const overridden = cloneTask<
          C,
          In,
          Out,
          D & TNewDeps,
          C,
          In,
          Out,
          TNewDeps
        >(next, {
          dependencies: nextDependencies as TNewDeps,
        });
        return makeTaskMiddlewareBuilder<C, In, Out, TNewDeps, false>(
          overridden,
        );
      }
      return makeTaskMiddlewareBuilder<C, In, Out, D & TNewDeps, false>(next);
    },

    configSchema<TNew>(schema: IValidationSchema<TNew>) {
      const next = cloneTask<C, In, Out, D, TNew, In, Out, D>(state, {
        configSchema: schema,
      });
      return makeTaskMiddlewareBuilder<TNew, In, Out, D, false>(next);
    },

    schema<TNew>(schema: IValidationSchema<TNew>) {
      return builder.configSchema(schema);
    },

    run(fn: ITaskMiddlewareDefinition<C, In, Out, D>["run"]) {
      const next = cloneTask(state, { run: fn as typeof state.run });
      return makeTaskMiddlewareBuilder<C, In, Out, D, true>(next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneTask(state, { meta: m as IMiddlewareMeta });
      return makeTaskMiddlewareBuilder<C, In, Out, D, THasRun>(next);
    },

    tags<TNewTags extends TaskMiddlewareTagType[]>(
      t: EnsureTagsForTarget<"taskMiddlewares", TNewTags>,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneTask(state, {
        tags: mergeArray(state.tags, t, override) as TaskMiddlewareTagType[],
      });
      return makeTaskMiddlewareBuilder<C, In, Out, D, false>(next);
    },

    throws(list: ThrowsList) {
      const next = cloneTask(state, { throws: list });
      return makeTaskMiddlewareBuilder<C, In, Out, D, THasRun>(next);
    },

    build() {
      // Fail-fast: validate required fields before creating middleware
      if (state.run === undefined) {
        builderIncompleteError.throw({
          type: "task-middleware",
          builderId: state.id,
          missingFields: ["run"],
          message: `Task middleware "${state.id}" is incomplete`,
        });
      }

      const middleware = defineTaskMiddleware({
        ...(state as ITaskMiddlewareDefinition<C, In, Out, D>),
      });
      return deepFreeze({
        ...middleware,
        [symbolFilePath]: state.filePath,
      });
    },
  };

  return builder as TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D> &
    TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D> &
    TaskMiddlewareFluentBuilder<C, In, Out, D, THasRun>;
}
