import type {
  DependencyMapType,
  IResource,
  IResourceDefinition,
  IResourceMeta,
  IValidationSchema,
  OverridableElements,
  RegisterableItems,
  ResourceMiddlewareAttachmentType,
  TagType,
} from "../../defs";
import { defineResource } from "../defineResource";

type BuilderState<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
> = Readonly<{
  id: string;
  dependencies?: TDeps | ((config: TConfig) => TDeps);
  register?:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
  middleware?: TMiddleware;
  tags?: TTags;
  context?: () => TContext;
  // Store init/dispose with generic-safe unknown parameter types to avoid contract coupling at build time.
  init?: (config: unknown, dependencies: unknown, context: unknown) => unknown;
  dispose?: (
    value: unknown,
    config: unknown,
    dependencies: unknown,
    context: unknown,
  ) => Promise<void>;
  configSchema?: IValidationSchema<any>;
  resultSchema?: IValidationSchema<any>;
  meta?: TMeta;
  overrides?: Array<OverridableElements>;
}>;

function clone<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  s: BuilderState<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>,
  patch: Partial<
    BuilderState<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>
  >,
) {
  return Object.freeze({ ...s, ...patch }) as BuilderState<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
}

export interface ResourceFluentBuilder<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TContext = any,
  TMeta extends IResourceMeta = IResourceMeta,
  TTags extends TagType[] = TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] = ResourceMiddlewareAttachmentType[],
> {
  id: string;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: TConfig) => TNewDeps),
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TNewDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  register(
    items:
      | Array<RegisterableItems>
      | ((config: TConfig) => Array<RegisterableItems>),
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  middleware<TNewMw extends ResourceMiddlewareAttachmentType[]>(
    mw: TNewMw,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TNewMw
  >;
  tags<TNewTags extends TagType[]>(
    tags: TNewTags,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TNewTags,
    TMiddleware
  >;
  context<TNewCtx>(
    factory: () => TNewCtx,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TNewCtx,
    TMeta,
    TTags,
    TMiddleware
  >;
  configSchema<TNewConfig>(
    schema: IValidationSchema<TNewConfig>,
  ): ResourceFluentBuilder<
    TNewConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  resultSchema<TResolved>(
    schema: IValidationSchema<TResolved>,
  ): ResourceFluentBuilder<
    TConfig,
    Promise<TResolved>,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  init<TNewValue extends Promise<any>>(
    fn: NonNullable<
      IResourceDefinition<
        TConfig,
        TNewValue,
        TDeps,
        TContext,
        any,
        any,
        TMeta,
        TTags,
        TMiddleware
      >["init"]
    >,
  ): ResourceFluentBuilder<
    TConfig,
    TNewValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  initObj<TNewValue extends Promise<any>>(
    fn: (input: {
      config: Parameters<
        NonNullable<
          IResourceDefinition<
            TConfig,
            TNewValue,
            TDeps,
            TContext,
            any,
            any,
            TMeta,
            TTags,
            TMiddleware
          >["init"]
        >
      >[0];
      deps: Parameters<
        NonNullable<
          IResourceDefinition<
            TConfig,
            TNewValue,
            TDeps,
            TContext,
            any,
            any,
            TMeta,
            TTags,
            TMiddleware
          >["init"]
        >
      >[1];
      ctx: Parameters<
        NonNullable<
          IResourceDefinition<
            TConfig,
            TNewValue,
            TDeps,
            TContext,
            any,
            any,
            TMeta,
            TTags,
            TMiddleware
          >["init"]
        >
      >[2];
    }) => TNewValue,
  ): ResourceFluentBuilder<
    TConfig,
    TNewValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  dispose(
    fn: NonNullable<
      IResourceDefinition<
        TConfig,
        TValue,
        TDeps,
        TContext,
        any,
        any,
        TMeta,
        TTags,
        TMiddleware
      >["dispose"]
    >,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  meta<TNewMeta extends IResourceMeta>(
    m: TNewMeta,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TNewMeta,
    TTags,
    TMiddleware
  >;
  overrides(
    o: Array<OverridableElements>,
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  lock(
    mutator?: (
      def: IResourceDefinition<
        TConfig,
        TValue,
        TDeps,
        TContext,
        any,
        any,
        TMeta,
        TTags,
        TMiddleware
      >,
    ) => void | IResourceDefinition<
      TConfig,
      TValue,
      TDeps,
      TContext,
      any,
      any,
      TMeta,
      TTags,
      TMiddleware
    >,
  ): IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>;
  build(): IResource<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
}

function makeResourceBuilder<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  state: BuilderState<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >,
): ResourceFluentBuilder<
  TConfig,
  TValue,
  TDeps,
  TContext,
  TMeta,
  TTags,
  TMiddleware
> {
  const b: ResourceFluentBuilder<any, any, any, any, any, any, any> = {
    id: state.id,
    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | ((config: TConfig) => TNewDeps),
    ) {
      const next = clone(state, { dependencies: deps as any });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TNewDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TConfig,
          TValue,
          TNewDeps,
          TContext,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    register(items) {
      const next = clone(state, { register: items as any });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },
    middleware<TNewMw extends ResourceMiddlewareAttachmentType[]>(mw: TNewMw) {
      const next = clone(state, { middleware: mw as unknown as any });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TNewMw
      >(
        next as unknown as BuilderState<
          TConfig,
          TValue,
          TDeps,
          TContext,
          TMeta,
          TTags,
          TNewMw
        >,
      );
    },
    tags<TNewTags extends TagType[]>(tags: TNewTags) {
      const next = clone(state, { tags: tags as unknown as any });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TNewTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TConfig,
          TValue,
          TDeps,
          TContext,
          TMeta,
          TNewTags,
          TMiddleware
        >,
      );
    },
    context<TNewCtx>(factory: () => TNewCtx) {
      const next = clone(state, { context: factory as any });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TNewCtx,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TConfig,
          TValue,
          TDeps,
          TNewCtx,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    configSchema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      const next = clone(state, { configSchema: schema });
      return makeResourceBuilder<
        TNewConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TNewConfig,
          TValue,
          TDeps,
          TContext,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    resultSchema<TResolved>(schema: IValidationSchema<TResolved>) {
      const next = clone(state, { resultSchema: schema });
      return makeResourceBuilder<
        TConfig,
        Promise<TResolved>,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TConfig,
          Promise<TResolved>,
          TDeps,
          TContext,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    init<TNewValue extends Promise<any>>(
      fn: NonNullable<
        IResourceDefinition<
          TConfig,
          TNewValue,
          TDeps,
          TContext,
          any,
          any,
          TMeta,
          TTags,
          TMiddleware
        >["init"]
      >,
    ) {
      const next = clone(state, {
        init: fn as unknown as (
          config: unknown,
          dependencies: unknown,
          context: unknown,
        ) => unknown,
      });
      return makeResourceBuilder<
        TConfig,
        TNewValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TConfig,
          TNewValue,
          TDeps,
          TContext,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    initObj<TNewValue extends Promise<any>>(
      fn: (input: {
        config: Parameters<
          NonNullable<
            IResourceDefinition<
              TConfig,
              TNewValue,
              TDeps,
              TContext,
              any,
              any,
              TMeta,
              TTags,
              TMiddleware
            >["init"]
          >
        >[0];
        deps: Parameters<
          NonNullable<
            IResourceDefinition<
              TConfig,
              TNewValue,
              TDeps,
              TContext,
              any,
              any,
              TMeta,
              TTags,
              TMiddleware
            >["init"]
          >
        >[1];
        ctx: Parameters<
          NonNullable<
            IResourceDefinition<
              TConfig,
              TNewValue,
              TDeps,
              TContext,
              any,
              any,
              TMeta,
              TTags,
              TMiddleware
            >["init"]
          >
        >[2];
      }) => TNewValue,
    ) {
      const wrapped = (config: unknown, deps: unknown, ctx: unknown) =>
        fn({ config: config as any, deps: deps as any, ctx: ctx as any });
      const next = clone(state, { init: wrapped });
      return makeResourceBuilder<
        TConfig,
        TNewValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TConfig,
          TNewValue,
          TDeps,
          TContext,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    dispose(fn) {
      const next = clone(state, {
        dispose: fn as unknown as (
          value: unknown,
          config: unknown,
          dependencies: unknown,
          context: unknown,
        ) => Promise<void>,
      });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },
    meta<TNewMeta extends IResourceMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m as unknown as any });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TNewMeta,
        TTags,
        TMiddleware
      >(
        next as unknown as BuilderState<
          TConfig,
          TValue,
          TDeps,
          TContext,
          TNewMeta,
          TTags,
          TMiddleware
        >,
      );
    },
    overrides(o: Array<OverridableElements>) {
      const next = clone(state, { overrides: o });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },
    lock(
      mutator?: (
        def: IResourceDefinition<
          TConfig,
          TValue,
          TDeps,
          TContext,
          any,
          any,
          TMeta,
          TTags,
          TMiddleware
        >,
      ) => void | IResourceDefinition<
        TConfig,
        TValue,
        TDeps,
        TContext,
        any,
        any,
        TMeta,
        TTags,
        TMiddleware
      >,
    ) {
      const def: IResourceDefinition<
        TConfig,
        TValue,
        TDeps,
        TContext,
        any,
        any,
        TMeta,
        TTags,
        TMiddleware
      > = { ...state } as unknown as IResourceDefinition<
        TConfig,
        TValue,
        TDeps,
        TContext,
        any,
        any,
        TMeta,
        TTags,
        TMiddleware
      >;
      const finalDef = mutator ? mutator(def) || def : def;
      return defineResource(finalDef);
    },
    build() {
      return defineResource({
        ...(state as unknown as IResourceDefinition<
          TConfig,
          TValue,
          TDeps,
          TContext,
          any,
          any,
          TMeta,
          TTags,
          TMiddleware
        >),
      });
    },
  };
  return b as ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
}

export function resourceBuilder(
  id: string,
): ResourceFluentBuilder<
  void,
  Promise<any>,
  {},
  any,
  IResourceMeta,
  TagType[],
  ResourceMiddlewareAttachmentType[]
> {
  const initial: BuilderState<
    void,
    Promise<any>,
    {},
    any,
    IResourceMeta,
    TagType[],
    ResourceMiddlewareAttachmentType[]
  > = Object.freeze({
    id,
    dependencies: {} as any,
    register: [] as any,
    middleware: [] as any,
    tags: [] as any,
    context: undefined as any,
    init: undefined as any,
    dispose: undefined as any,
    configSchema: undefined as any,
    resultSchema: undefined as any,
    meta: {} as any,
    overrides: [] as any,
  });
  return makeResourceBuilder(initial);
}

export const resource = resourceBuilder;
