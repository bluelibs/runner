import type {
  DependencyMapType,
  ITaskMeta,
  IValidationSchema,
  TagType,
  TaskMiddlewareAttachmentType,
  IPhantomTask,
} from "../../defs";
import { defineTask } from "../defineTask";

type PhantomBuilderState<
  TInput,
  TResolved,
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
  tags?: TTags;
}>;

function clone<
  TInput,
  TResolved,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
  TNextInput = TInput,
  TNextResolved = TResolved,
  TNextDeps extends DependencyMapType = TDeps,
  TNextMeta extends ITaskMeta = TMeta,
  TNextTags extends TagType[] = TTags,
  TNextMiddleware extends TaskMiddlewareAttachmentType[] = TMiddleware,
>(
  s: PhantomBuilderState<TInput, TResolved, TDeps, TMeta, TTags, TMiddleware>,
  patch: Partial<
    PhantomBuilderState<
      TNextInput,
      TNextResolved,
      TNextDeps,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >
  >,
): PhantomBuilderState<
  TNextInput,
  TNextResolved,
  TNextDeps,
  TNextMeta,
  TNextTags,
  TNextMiddleware
> {
  return Object.freeze({
    ...(s as unknown as PhantomBuilderState<
      TNextInput,
      TNextResolved,
      TNextDeps,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >),
    ...patch,
  }) as PhantomBuilderState<
    TNextInput,
    TNextResolved,
    TNextDeps,
    TNextMeta,
    TNextTags,
    TNextMiddleware
  >;
}

function mergeArray<T>(
  existing: ReadonlyArray<T> | undefined,
  addition: ReadonlyArray<T>,
  override: boolean,
): T[] {
  const toArray = [...addition];
  if (override || !existing) {
    return toArray as T[];
  }
  return [...existing, ...toArray] as T[];
}

function mergeDepsNoConfig<
  TExisting extends DependencyMapType,
  TNew extends DependencyMapType,
>(
  existing: TExisting | (() => TExisting) | undefined,
  addition: TNew | (() => TNew),
  override: boolean,
): (TExisting & TNew) | (() => TExisting & TNew) {
  const isFnExisting = typeof existing === "function";
  const isFnAddition = typeof addition === "function";

  if (override || !existing) {
    return (addition as any) as (TExisting & TNew) | (() => TExisting & TNew);
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as () => TNew;
    return (() => ({ ...(e() as any), ...(a() as any) })) as any;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as () => TExisting;
    const a = addition as TNew;
    return (() => ({ ...(e() as any), ...(a as any) })) as any;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as () => TNew;
    return (() => ({ ...(e as any), ...(a() as any) })) as any;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return ({ ...(e as any), ...(a as any) }) as any;
}

export interface PhantomTaskFluentBuilder<
  TInput = undefined,
  TResolved = any,
  TDeps extends DependencyMapType = {},
  TMeta extends ITaskMeta = ITaskMeta,
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] = TaskMiddlewareAttachmentType[],
> {
  id: string;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: false },
  ): PhantomTaskFluentBuilder<
    TInput,
    TResolved,
    TDeps & TNewDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options: { override: true },
  ): PhantomTaskFluentBuilder<
    TInput,
    TResolved,
    TNewDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
  middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(
    mw: TNewMw,
    options?: { override?: boolean },
  ): PhantomTaskFluentBuilder<TInput, TResolved, TDeps, TMeta, TTags, TNewMw>;
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
  ): PhantomTaskFluentBuilder<TInput, TResolved, TDeps, TMeta, TNewTags, TMiddleware>;
  inputSchema<TNewInput>(
    schema: IValidationSchema<TNewInput>,
  ): PhantomTaskFluentBuilder<
    TNewInput,
    TResolved,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
  resultSchema<TNewResolved>(
    schema: IValidationSchema<TNewResolved>,
  ): PhantomTaskFluentBuilder<
    TInput,
    TNewResolved,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): PhantomTaskFluentBuilder<TInput, TResolved, TDeps, TNewMeta, TTags, TMiddleware>;
  build(): IPhantomTask<TInput, TResolved, TDeps, TMeta, TTags, TMiddleware>;
}

function makePhantomTaskBuilder<
  TInput,
  TResolved,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
>(
  state: PhantomBuilderState<TInput, TResolved, TDeps, TMeta, TTags, TMiddleware>,
): PhantomTaskFluentBuilder<TInput, TResolved, TDeps, TMeta, TTags, TMiddleware> {
  const builder: PhantomTaskFluentBuilder<TInput, TResolved, TDeps, TMeta, TTags, TMiddleware> = {
    id: state.id,
    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | (() => TNewDeps),
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TResolved,
        any,
        TMeta,
        TTags,
        TMiddleware
      >(state as any, {
        dependencies: mergeDepsNoConfig<TDeps, TNewDeps>(
          state.dependencies as any,
          deps as any,
          override,
        ) as any,
      }) as any;
      if (override) {
        return makePhantomTaskBuilder<
          TInput,
          TResolved,
          TNewDeps,
          TMeta,
          TTags,
          TMiddleware
        >(next as any);
      }
      return makePhantomTaskBuilder<
        TInput,
        TResolved,
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
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TNewMw
      >(state as any, {
        middleware: mergeArray(state.middleware as any, mw, override) as any,
      }) as any;
      return makePhantomTaskBuilder<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TNewMw
      >(next);
    },
    tags<TNewTags extends TagType[]>(t: TNewTags) {
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TNewTags,
        TMiddleware
      >(state as any, { tags: t }) as any;
      return makePhantomTaskBuilder<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TNewTags,
        TMiddleware
      >(next);
    },
    inputSchema<TNewInput>(schema: IValidationSchema<TNewInput>) {
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TNewInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(state as any, { inputSchema: schema }) as any;
      return makePhantomTaskBuilder<
        TNewInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },
    resultSchema<TNewResolved>(schema: IValidationSchema<TNewResolved>) {
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TNewResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(state as any, { resultSchema: schema }) as any;
      return makePhantomTaskBuilder<
        TInput,
        TNewResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },
    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TResolved,
        TDeps,
        TNewMeta,
        TTags,
        TMiddleware
      >(state as any, { meta: m }) as any;
      return makePhantomTaskBuilder<
        TInput,
        TResolved,
        TDeps,
        TNewMeta,
        TTags,
        TMiddleware
      >(next);
    },
    build() {
      const built = defineTask.phantom<TInput, Promise<TResolved>>({
        id: state.id,
        dependencies: state.dependencies as any,
        middleware: state.middleware as any,
        inputSchema: state.inputSchema as any,
        resultSchema: state.resultSchema as any,
        meta: state.meta as any,
        tags: state.tags as any,
      });
      return built as IPhantomTask<TInput, TResolved, TDeps, TMeta, TTags, TMiddleware>;
    },
  };
  return builder;
}

export function phantomTaskBuilder<
  TInput = undefined,
  TResolved = any,
>(
  id: string,
): PhantomTaskFluentBuilder<
  TInput,
  TResolved,
  {},
  ITaskMeta,
  TagType[],
  TaskMiddlewareAttachmentType[]
> {
  const initial: PhantomBuilderState<
    TInput,
    TResolved,
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
    tags: [] as any,
  });
  return makePhantomTaskBuilder(initial);
}

