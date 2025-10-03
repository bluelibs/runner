import type {
  DependencyMapType,
  ITask,
  ITaskDefinition,
  ITaskMeta,
  IValidationSchema,
  TagType,
  TaskMiddlewareAttachmentType,
} from "../../defs";
import { symbolFilePath } from "../../defs";
import { defineTask } from "../defineTask";
import { cloneState, mergeArray, mergeDepsNoConfig } from "./utils";
import { phantomTaskBuilder, type PhantomTaskFluentBuilder } from "./task.phantom";
import { getCallerFile } from "../../tools/getCallerFile";

type ShouldReplaceInput<T> = [T] extends [undefined] ? true : [T] extends [void] ? true : (0 extends 1 & T ? true : false);
type ResolveInput<TExisting, TProposed> = ShouldReplaceInput<TExisting> extends true
  ? TProposed
  : TExisting;

type BuilderState<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
> = Readonly<{
  id: string;
  filePath: string;
  dependencies?: TDeps | (() => TDeps);
  middleware?: TMiddleware;
  meta?: TMeta;
  inputSchema?: IValidationSchema<any>;
  resultSchema?: IValidationSchema<any>;
  run?: (input: unknown, dependencies: unknown) => unknown;
  tags?: TTags;
}>;

function clone<
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
  s: BuilderState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
  patch: Partial<
    BuilderState<
      TNextInput,
      TNextOutput,
      TNextDeps,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >
  >,
): BuilderState<
  TNextInput,
  TNextOutput,
  TNextDeps,
  TNextMeta,
  TNextTags,
  TNextMiddleware
> {
  return cloneState<
    BuilderState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
    BuilderState<
      TNextInput,
      TNextOutput,
      TNextDeps,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >
  >(s as any, patch as any);
}

export interface TaskFluentBuilder<
  TInput = undefined,
  TOutput extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TMeta extends ITaskMeta = ITaskMeta,
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] = TaskMiddlewareAttachmentType[],
> {
  id: string;
  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: false },
  ): TaskFluentBuilder<
    TInput,
    TOutput,
    TDeps & TNewDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options: { override: true },
  ): TaskFluentBuilder<
    TInput,
    TOutput,
    TNewDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
  middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(
    mw: TNewMw,
    options?: { override?: boolean },
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TNewMw>;
  // Append signature (default)
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options?: { override?: false },
  ): TaskFluentBuilder<
    TInput,
    TOutput,
    TDeps,
    TMeta,
    [...TTags, ...TNewTags],
    TMiddleware
  >;
  // Override signature (replace)
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options: { override: true },
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TNewTags, TMiddleware>;
  inputSchema<TNewInput>(
    schema: IValidationSchema<TNewInput>,
  ): TaskFluentBuilder<TNewInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;
  resultSchema<TResolved>(
    schema: IValidationSchema<TResolved>,
  ): TaskFluentBuilder<
    TInput,
    Promise<TResolved>,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
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
  ): TaskFluentBuilder<
    ResolveInput<TInput, TNewInput>,
    TNewOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;

  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TNewMeta, TTags, TMiddleware>;
  build(): ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;
}

// PhantomTaskFluentBuilder is defined in task.phantom.ts

// mergeArray and mergeDepsNoConfig imported from ./utils

function makeTaskBuilder<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
>(
  state: BuilderState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware> {
  const builder: TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware> = {
    id: state.id,
    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | (() => TNewDeps),
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
        any,
        TMeta,
        TTags,
        TMiddleware
      >(state, {
        dependencies: mergeDepsNoConfig<TDeps, TNewDeps>(
          state.dependencies as any,
          deps as any,
          override,
        ) as any,
      });
      if (override) {
        return makeTaskBuilder<
          TInput,
          TOutput,
          TNewDeps,
          TMeta,
          TTags,
          TMiddleware
        >(next as any);
      }
      return makeTaskBuilder<
        TInput,
        TOutput,
        TDeps & TNewDeps,
        TMeta,
        TTags,
        TMiddleware
      >(next as any);
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
        middleware: mergeArray(state.middleware, mw, override) as any,
      });
      return makeTaskBuilder<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TNewMw
      >(next);
    },
    tags<TNewTags extends TagType[]>(t: TNewTags, options?: { override?: boolean }) {
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
      >(state, { tags: mergeArray(state.tags, t, override) as any });
      return makeTaskBuilder(next as any) as any;
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
          deps as Parameters<
            ITaskDefinition<
              ResolveInput<TInput, TNewInput>,
              TNewOutput,
              TDeps,
              TMeta,
              TTags,
              TMiddleware
            >["run"]
          >[1],
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
    build() {
      const task = defineTask({
        ...(state as unknown as ITaskDefinition<
          TInput,
          TOutput,
          TDeps,
          TMeta,
          TTags,
          TMiddleware
        >),
      });
      (task as any)[symbolFilePath] = state.filePath;
      return task;
    },
  };
  return builder;
}

export function taskBuilder(
  id: string,
): TaskFluentBuilder<
  undefined,
  Promise<any>,
  {},
  ITaskMeta,
  TagType[],
  TaskMiddlewareAttachmentType[]
> {
  const filePath = getCallerFile();
  const initial: BuilderState<
    undefined,
    Promise<any>,
    {},
    ITaskMeta,
    TagType[],
    TaskMiddlewareAttachmentType[]
  > = Object.freeze({
    id,
    filePath,
    dependencies: {} as any,
    middleware: [] as any,
    meta: {} as any,
    inputSchema: undefined as any,
    resultSchema: undefined as any,
    run: undefined as any,
    tags: [] as any,
  });
  return makeTaskBuilder(initial);
}

// Phantom task builder moved to task.phantom.ts

export interface TaskBuilderWithPhantom {
  (id: string): TaskFluentBuilder<
    undefined,
    Promise<any>,
    {},
    ITaskMeta,
    TagType[],
    TaskMiddlewareAttachmentType[]
  >;
  phantom: <TInput = undefined, TResolved = any>(
    id: string,
  ) => PhantomTaskFluentBuilder<
    TInput,
    TResolved,
    {},
    ITaskMeta,
    TagType[],
    TaskMiddlewareAttachmentType[]
  >;
}

export const task: TaskBuilderWithPhantom = Object.assign(taskBuilder, {
  phantom: phantomTaskBuilder,
});
