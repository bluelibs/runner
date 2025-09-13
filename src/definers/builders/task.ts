import type {
  DependencyMapType,
  ITask,
  ITaskDefinition,
  ITaskMeta,
  IValidationSchema,
  TagType,
  TaskMiddlewareAttachmentType,
} from "../../defs";
import { defineTask } from "../defineTask";

type BuilderState<
  TInput,
  TOutput extends Promise<any>,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
> = Readonly<{
  id: string;
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
>(
  s: BuilderState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
  patch: Partial<
    BuilderState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>
  >,
) {
  return Object.freeze({ ...s, ...patch }) as BuilderState<
    TInput,
    TOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
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
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
  ): TaskFluentBuilder<TInput, TOutput, TNewDeps, TMeta, TTags, TMiddleware>;
  middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(
    mw: TNewMw,
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TMeta, TTags, TNewMw>;
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
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
  run<TNewOutput extends Promise<any>>(
    fn: NonNullable<
      ITaskDefinition<
        TInput,
        TNewOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >["run"]
    >,
  ): TaskFluentBuilder<TInput, TNewOutput, TDeps, TMeta, TTags, TMiddleware>;
  runObj<TNewOutput extends Promise<any>>(
    fn: (input: {
      input: Parameters<
        NonNullable<
          ITaskDefinition<
            TInput,
            TNewOutput,
            TDeps,
            TMeta,
            TTags,
            TMiddleware
          >["run"]
        >
      >[0];
      deps: Parameters<
        NonNullable<
          ITaskDefinition<
            TInput,
            TNewOutput,
            TDeps,
            TMeta,
            TTags,
            TMiddleware
          >["run"]
        >
      >[1];
    }) => TNewOutput,
  ): TaskFluentBuilder<TInput, TNewOutput, TDeps, TMeta, TTags, TMiddleware>;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): TaskFluentBuilder<TInput, TOutput, TDeps, TNewMeta, TTags, TMiddleware>;
  build(): ITask<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>;
}

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
  const b: TaskFluentBuilder<any, any, any, any, any, any> = {
    id: state.id,
    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | (() => TNewDeps),
    ) {
      const next = clone(state, { dependencies: deps as unknown as any });
      return makeTaskBuilder<
        TInput,
        TOutput,
        TNewDeps,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TInput,
          TOutput,
          TNewDeps,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(mw: TNewMw) {
      const next = clone(state, { middleware: mw as unknown as any });
      return makeTaskBuilder<TInput, TOutput, TDeps, TMeta, TTags, TNewMw>(
        next as unknown as BuilderState<
          TInput,
          TOutput,
          TDeps,
          TMeta,
          TTags,
          TNewMw
        >,
      );
    },
    tags<TNewTags extends TagType[]>(t: TNewTags) {
      const next = clone(state, { tags: t as unknown as any });
      return makeTaskBuilder<
        TInput,
        TOutput,
        TDeps,
        TMeta,
        TNewTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TInput,
          TOutput,
          TDeps,
          TMeta,
          TNewTags,
          TMiddleware
        >,
      );
    },
    inputSchema<TNewInput>(schema: IValidationSchema<TNewInput>) {
      const next = clone(state, { inputSchema: schema });
      return makeTaskBuilder<
        TNewInput,
        TOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TNewInput,
          TOutput,
          TDeps,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    resultSchema<TResolved>(schema: IValidationSchema<TResolved>) {
      const next = clone(state, { resultSchema: schema });
      return makeTaskBuilder<
        TInput,
        Promise<TResolved>,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TInput,
          Promise<TResolved>,
          TDeps,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    run<TNewOutput extends Promise<any>>(
      fn: NonNullable<
        ITaskDefinition<
          TInput,
          TNewOutput,
          TDeps,
          TMeta,
          TTags,
          TMiddleware
        >["run"]
      >,
    ) {
      const next = clone(state, {
        run: fn as unknown as (
          input: unknown,
          dependencies: unknown,
        ) => unknown,
      });
      return makeTaskBuilder<
        TInput,
        TNewOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TInput,
          TNewOutput,
          TDeps,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    runObj<TNewOutput extends Promise<any>>(
      fn: (input: {
        input: Parameters<
          NonNullable<
            ITaskDefinition<
              TInput,
              TNewOutput,
              TDeps,
              TMeta,
              TTags,
              TMiddleware
            >["run"]
          >
        >[0];
        deps: Parameters<
          NonNullable<
            ITaskDefinition<
              TInput,
              TNewOutput,
              TDeps,
              TMeta,
              TTags,
              TMiddleware
            >["run"]
          >
        >[1];
      }) => TNewOutput,
    ) {
      const wrapped = (input: unknown, deps: unknown) =>
        fn({ input: input as any, deps: deps as any });
      const next = clone(state, { run: wrapped });
      return makeTaskBuilder<
        TInput,
        TNewOutput,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TInput,
          TNewOutput,
          TDeps,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m as unknown as any });
      return makeTaskBuilder<
        TInput,
        TOutput,
        TDeps,
        TNewMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TInput,
          TOutput,
          TDeps,
          TNewMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    build() {
      return defineTask({
        ...(state as unknown as ITaskDefinition<
          TInput,
          TOutput,
          TDeps,
          TMeta,
          TTags,
          TMiddleware
        >),
      });
    },
  };
  return b as TaskFluentBuilder<
    TInput,
    TOutput,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
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
  const initial: BuilderState<
    undefined,
    Promise<any>,
    {},
    ITaskMeta,
    TagType[],
    TaskMiddlewareAttachmentType[]
  > = Object.freeze({
    id,
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

export const task = taskBuilder;
