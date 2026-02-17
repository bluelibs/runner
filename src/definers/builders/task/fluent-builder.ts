import type {
  DependencyMapType,
  DependencyValuesType,
  ITaskDefinition,
  ITaskMeta,
  IValidationSchema,
  TagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import { builderIncompleteError } from "../../../errors";
import { defineTask } from "../../defineTask";
import type { TaskFluentBuilder } from "./fluent-builder.interface";
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
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
>(
  state: BuilderState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware> {
  const builder: TaskFluentBuilder<
    TInput,
    TOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  > = {
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
        dependencies: nextDependencies as unknown as TDeps & TNewDeps,
      });

      return makeTaskBuilder(next);
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
      return makeTaskBuilder(next);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
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
      return makeTaskBuilder(next);
    },

    inputSchema<TNewInput>(schema: IValidationSchema<TNewInput>) {
      const next = clone<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TNewInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(state, { inputSchema: schema });
      return makeTaskBuilder<
        TNewInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },

    resultSchema<TResolved>(schema: IValidationSchema<TResolved>) {
      const next = clone<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        Promise<TResolved>,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(state, { resultSchema: schema });
      return makeTaskBuilder<
        TInput,
        Promise<TResolved>,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
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
          deps as unknown as DependencyValuesType<TDeps>, // Dependencies are injected at runtime
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
        TMiddleware
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
        TMiddleware
      >(next);
    },

    throws(list: ThrowsList) {
      const next = clone(state, { throws: list });
      return makeTaskBuilder<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>(
        next,
      );
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
      (task as { [symbolFilePath]?: string })[symbolFilePath] = state.filePath;
      return task;
    },
  };
  return builder;
}
