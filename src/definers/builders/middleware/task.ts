import type {
  DependencyMapType,
  EnsureTagsForTarget,
  ResolveValidationSchemaInput,
  ITaskMiddlewareDefinition,
  IMiddlewareMeta,
  TaskMiddlewareTagType,
  ValidationSchemaInput,
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
  TTags extends TaskMiddlewareTagType[],
  THasRun extends boolean = false,
>(
  state: TaskMwState<C, In, Out, D, TTags>,
): TaskMiddlewareFluentBuilder<C, In, Out, D, TTags, THasRun> {
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

      const next = cloneTask<
        C,
        In,
        Out,
        D,
        TTags,
        C,
        In,
        Out,
        D & TNewDeps,
        TTags
      >(state, {
        dependencies: nextDependencies as D & TNewDeps,
      });

      if (override) {
        const overridden = cloneTask<
          C,
          In,
          Out,
          D & TNewDeps,
          TTags,
          C,
          In,
          Out,
          TNewDeps,
          TTags
        >(next, {
          dependencies: nextDependencies as TNewDeps,
        });
        return makeTaskMiddlewareBuilder<C, In, Out, TNewDeps, TTags, false>(
          overridden,
        );
      }
      return makeTaskMiddlewareBuilder<C, In, Out, D & TNewDeps, TTags, false>(
        next,
      );
    },

    configSchema<
      TNew = never,
      TSchema extends ValidationSchemaInput<
        [TNew] extends [never] ? any : TNew
      > = ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
    >(schema: TSchema) {
      const next = cloneTask<
        C,
        In,
        Out,
        D,
        TTags,
        ResolveValidationSchemaInput<TNew, TSchema>,
        In,
        Out,
        D,
        TTags
      >(state, {
        configSchema: schema,
      });
      return makeTaskMiddlewareBuilder<
        ResolveValidationSchemaInput<TNew, TSchema>,
        In,
        Out,
        D,
        TTags,
        false
      >(next);
    },

    schema<
      TNew = never,
      TSchema extends ValidationSchemaInput<
        [TNew] extends [never] ? any : TNew
      > = ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
    >(schema: TSchema) {
      return builder.configSchema(schema);
    },

    run(fn: ITaskMiddlewareDefinition<C, In, Out, D, TTags>["run"]) {
      const next = cloneTask(state, { run: fn as typeof state.run });
      return makeTaskMiddlewareBuilder<C, In, Out, D, TTags, true>(next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneTask(state, { meta: m as IMiddlewareMeta });
      return makeTaskMiddlewareBuilder<C, In, Out, D, TTags, THasRun>(next);
    },

    tags<TNewTags extends TaskMiddlewareTagType[]>(
      t: EnsureTagsForTarget<"taskMiddlewares", TNewTags>,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      if (override) {
        const nextTags = mergeArray(state.tags, t, true) as TNewTags;
        const next = cloneTask<C, In, Out, D, TTags, C, In, Out, D, TNewTags>(
          state,
          {
            tags: nextTags,
          },
        );
        return makeTaskMiddlewareBuilder<C, In, Out, D, TNewTags, false>(next);
      }

      const nextTags = mergeArray(state.tags, t, false) as [
        ...TTags,
        ...TNewTags,
      ];
      const next = cloneTask<
        C,
        In,
        Out,
        D,
        TTags,
        C,
        In,
        Out,
        D,
        [...TTags, ...TNewTags]
      >(state, {
        tags: nextTags,
      });
      return makeTaskMiddlewareBuilder<
        C,
        In,
        Out,
        D,
        [...TTags, ...TNewTags],
        false
      >(next);
    },

    throws(list: ThrowsList) {
      const next = cloneTask(state, { throws: list });
      return makeTaskMiddlewareBuilder<C, In, Out, D, TTags, THasRun>(next);
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
        ...(state as ITaskMiddlewareDefinition<C, In, Out, D, TTags>),
      });
      return deepFreeze({
        ...middleware,
        [symbolFilePath]: state.filePath,
      });
    },
  };

  return builder as TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D, TTags> &
    TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags> &
    TaskMiddlewareFluentBuilder<C, In, Out, D, TTags, THasRun>;
}
