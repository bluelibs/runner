import type {
  DependencyMapType,
  DependencyValuesType,
  ITask,
  ITaskDefinition,
  ITaskMeta,
  IValidationSchema,
  TagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import { normalizeThrows } from "../../../tools/throws";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineOverride } from "../../defineOverride";
import type { TaskFluentBuilder } from "../task/fluent-builder.interface";
import type { ResolveInput } from "../task/types";
import { mergeArray, mergeDependencies } from "../task/utils";

type AnyTask = ITask<any, any, any, any, any, any>;

type TaskOverrideState<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
> = Readonly<
  ITaskDefinition<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>
>;

function cloneTaskState<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
  TNextInput = TInput,
  TNextOutput extends Promise<any> = TOutput,
  TNextDeps extends DependencyMapType = TDeps,
  TNextMeta extends ITaskMeta = TMeta,
  TNextTags extends TagType[] = TTags,
  TNextMiddleware extends TaskMiddlewareAttachmentType[] = TMiddleware,
>(
  state: TaskOverrideState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
  patch: Partial<
    TaskOverrideState<
      TNextInput,
      TNextOutput,
      TNextDeps,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >
  >,
): TaskOverrideState<
  TNextInput,
  TNextOutput,
  TNextDeps,
  TNextMeta,
  TNextTags,
  TNextMiddleware
> {
  const next = {
    ...state,
    ...patch,
  } as TaskOverrideState<
    TNextInput,
    TNextOutput,
    TNextDeps,
    TNextMeta,
    TNextTags,
    TNextMiddleware
  >;
  return Object.freeze(next);
}

function makeTaskOverrideBuilder<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
>(
  base: AnyTask,
  state: TaskOverrideState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
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

      const next = cloneTaskState<
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

      return makeTaskOverrideBuilder(base, next);
    },

    middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(
      mw: TNewMw,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneTaskState<
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
      return makeTaskOverrideBuilder(base, next);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneTaskState<
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
      return makeTaskOverrideBuilder(base, next);
    },

    inputSchema<TNewInput>(schema: IValidationSchema<TNewInput>) {
      const next = cloneTaskState<
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
      return makeTaskOverrideBuilder<
        TNewInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },

    schema<TNewInput>(schema: IValidationSchema<TNewInput>) {
      return builder.inputSchema(schema);
    },

    resultSchema<TResolved>(schema: IValidationSchema<TResolved>) {
      const next = cloneTaskState<
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
      return makeTaskOverrideBuilder<
        TInput,
        Promise<TResolved>,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
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
          deps as DependencyValuesType<TDeps>,
        );

      const next = cloneTaskState<
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
      return makeTaskOverrideBuilder<
        ResolveInput<TInput, TNewInput>,
        TNewOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },

    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = cloneTaskState<
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
      return makeTaskOverrideBuilder<
        TInput,
        TOutput,
        TDeps,
        TNewMeta,
        TTags,
        TMiddleware
      >(base, next);
    },

    throws(list: ThrowsList) {
      const next = cloneTaskState(state, { throws: list });
      return makeTaskOverrideBuilder<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },

    build() {
      const normalizedThrows = normalizeThrows(
        { kind: "task", id: state.id },
        state.throws,
      );
      const { id: _id, ...patch } = state;
      return deepFreeze(
        defineOverride<
          ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>
        >(base, { ...patch, throws: normalizedThrows }),
      );
    },
  };

  return builder;
}

export function taskOverrideBuilder<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
>(
  base: ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware> {
  const initial: TaskOverrideState<
    TInput,
    TOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  > = Object.freeze({
    id: base.id,
    dependencies: base.dependencies,
    middleware: base.middleware,
    inputSchema: base.inputSchema,
    resultSchema: base.resultSchema,
    throws: base.throws,
    run: base.run,
    tags: base.tags,
    meta: base.meta,
  });

  return makeTaskOverrideBuilder(base, initial);
}
