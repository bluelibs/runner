import type {
  DependencyMapType,
  ITaskMiddlewareDefinition,
  IValidationSchema,
  IMiddlewareMeta,
  TagType,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import type { ThrowsList } from "../../../types/error";
import { builderIncompleteError } from "../../../errors";
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
        return makeTaskMiddlewareBuilder<C, In, Out, TNewDeps>(overridden);
      }
      return makeTaskMiddlewareBuilder<C, In, Out, D & TNewDeps>(next);
    },

    configSchema<TNew>(schema: IValidationSchema<TNew>) {
      const next = cloneTask<C, In, Out, D, TNew, In, Out, D>(state, {
        configSchema: schema,
      });
      return makeTaskMiddlewareBuilder<TNew, In, Out, D>(next);
    },

    schema<TNew>(schema: IValidationSchema<TNew>) {
      return builder.configSchema(schema);
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

    throws(list: ThrowsList) {
      const next = cloneTask(state, { throws: list });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
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
      (middleware as { [symbolFilePath]?: string })[symbolFilePath] =
        state.filePath;
      return deepFreeze(middleware);
    },
  };

  return builder;
}
