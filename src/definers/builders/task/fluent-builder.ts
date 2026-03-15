import type {
  DependencyMapType,
  DependencyValuesType,
  EnsureTagsForTarget,
  ITaskDefinition,
  ITaskMeta,
  TagType,
  TaskTagType,
  TaskMiddlewareAttachmentType,
  ResolveValidationSchemaInput,
  ValidationSchemaInput,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import type { ThrowsList } from "../../../types/error";
import { builderIncompleteError } from "../../../errors";
import { defineTask } from "../../defineTask";
import type {
  TaskFluentBuilder,
  TaskFluentBuilderAfterRun,
  TaskFluentBuilderPhase,
} from "./fluent-builder.interface";
import type { BuilderState, ResolveInput } from "./types";
import { clone, mergeArray, mergeDependencies } from "./utils";

/**
 * Creates a TaskFluentBuilder from the given state.
 * Each builder method returns a new builder with updated state.
 */
export function makeTaskBuilder<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
  THasRun extends boolean = false,
>(
  state: BuilderState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
): TaskFluentBuilderPhase<
  TInput,
  TOutput,
  TDeps,
  TMeta,
  TTags,
  TMiddleware,
  THasRun
> {
  const builder = {
    id: state.id,
    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | (() => TNewDeps),
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const nextDependencies = mergeDependencies<TDeps, TNewDeps>(
        state.dependencies as TDeps | (() => TDeps),
        deps,
        override,
      );

      const next = clone<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TOutput,
        TDeps & TNewDeps,
        TMeta,
        TTags,
        TMiddleware
      >(state, {
        dependencies: nextDependencies as TDeps & TNewDeps,
      });

      return makeTaskBuilder<
        TInput,
        TOutput,
        TDeps & TNewDeps,
        TMeta,
        TTags,
        TMiddleware,
        false
      >(next);
    },

    middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(
      mw: TNewMw,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TNewMw
      >(state, {
        middleware: mergeArray(state.middleware, mw, override) as TNewMw,
      });
      return makeTaskBuilder<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TNewMw,
        false
      >(next);
    },

    tags<const TNewTags extends TagType[]>(
      t: EnsureTagsForTarget<"tasks", TNewTags>,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TOutput,
        TDeps,
        TMeta,
        [...TTags, ...TNewTags],
        TMiddleware
      >(state, {
        tags: mergeArray(state.tags, t, override) as [...TTags, ...TNewTags],
      });
      return makeTaskBuilder<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        [...TTags, ...TNewTags],
        TMiddleware,
        false
      >(next);
    },

    inputSchema<
      TNewInput = never,
      TSchema extends ValidationSchemaInput<
        [TNewInput] extends [never] ? any : TNewInput
      > = ValidationSchemaInput<[TNewInput] extends [never] ? any : TNewInput>,
    >(schema: TSchema) {
      const next = clone<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        ResolveValidationSchemaInput<TNewInput, TSchema>,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(state, { inputSchema: schema });
      return makeTaskBuilder<
        ResolveValidationSchemaInput<TNewInput, TSchema>,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        false
      >(next);
    },

    schema<
      TNewInput = never,
      TSchema extends ValidationSchemaInput<
        [TNewInput] extends [never] ? any : TNewInput
      > = ValidationSchemaInput<[TNewInput] extends [never] ? any : TNewInput>,
    >(schema: TSchema) {
      return builder.inputSchema(schema);
    },

    resultSchema<
      TResolved = never,
      TSchema extends ValidationSchemaInput<
        [TResolved] extends [never] ? any : TResolved
      > = ValidationSchemaInput<[TResolved] extends [never] ? any : TResolved>,
    >(schema: TSchema) {
      const next = clone<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        Promise<ResolveValidationSchemaInput<TResolved, TSchema>>,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(state, { resultSchema: schema });
      return makeTaskBuilder<
        TInput,
        Promise<ResolveValidationSchemaInput<TResolved, TSchema>>,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        false
      >(next);
    },

    run<TNewInput = TInput, TNewOutput extends Promise<any> = TOutput>(
      fn: NonNullable<
        ITaskDefinition<
          ResolveInput<TInput, TNewInput>,
          TNewOutput,
          TDeps,
          TMeta,
          TTags,
          TMiddleware
        >["run"]
      >,
    ) {
      const wrapped = (input: unknown, deps: unknown) =>
        fn(
          input as ResolveInput<TInput, TNewInput>,
          deps as DependencyValuesType<TDeps>, // Dependencies are injected at runtime
        );

      const next = clone<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        ResolveInput<TInput, TNewInput>,
        TNewOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(state, { run: wrapped });
      return makeTaskBuilder<
        ResolveInput<TInput, TNewInput>,
        TNewOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        true
      >(next);
    },

    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = clone<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TOutput,
        TDeps,
        TNewMeta,
        TTags,
        TMiddleware
      >(state, { meta: m });
      return makeTaskBuilder<
        TInput,
        TOutput,
        TDeps,
        TNewMeta,
        TTags,
        TMiddleware,
        THasRun
      >(next);
    },

    throws(list: ThrowsList) {
      const next = clone(state, { throws: list });
      return makeTaskBuilder<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        THasRun
      >(next);
    },

    build() {
      // Fail-fast: task definitions require a run handler.
      if (state.run === undefined) {
        builderIncompleteError.throw({
          type: "task",
          builderId: state.id,
          missingFields: ["run"],
          message: `Task "${state.id}" is incomplete`,
        });
      }

      const definition: ITaskDefinition<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      > = {
        id: state.id,
        dependencies: state.dependencies,
        middleware: state.middleware,
        inputSchema: state.inputSchema,
        resultSchema: state.resultSchema,
        throws: state.throws,
        run: state.run as NonNullable<
          ITaskDefinition<
            TInput,
            TOutput,
            TDeps,
            TMeta,
            TTags,
            TMiddleware
          >["run"]
        >,
        tags: state.tags,
        meta: state.meta,
      };

      const task = defineTask(definition);
      return deepFreeze({
        ...task,
        [symbolFilePath]: state.filePath,
      });
    },
  };
  return builder as TaskFluentBuilder<
    TInput,
    TOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  > &
    TaskFluentBuilderAfterRun<
      TInput,
      TOutput,
      TDeps,
      TMeta,
      TTags,
      TMiddleware
    > &
    TaskFluentBuilderPhase<
      TInput,
      TOutput,
      TDeps,
      TMeta,
      TTags,
      TMiddleware,
      THasRun
    >;
}
