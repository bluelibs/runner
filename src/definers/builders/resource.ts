import type {
  DependencyMapType,
  IResource,
  IResourceDefinition,
  IResourceMeta,
  IValidationSchema,
  OverridableElements,
  RegisterableItems,
  ResourceInitFn,
  ResourceMiddlewareAttachmentType,
  TagType,
} from "../../defs";
import { symbolFilePath } from "../../defs";
import { defineResource } from "../defineResource";
import { getCallerFile } from "../../tools/getCallerFile";

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
  filePath: string;
  dependencies?: TDeps | ((config: TConfig) => TDeps);
  register?:
    | Array<RegisterableItems>
    | ((config: TConfig) => Array<RegisterableItems>);
  middleware?: TMiddleware;
  tags?: TTags;
  context?: () => TContext;
  init?: ResourceInitFn<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  dispose?: NonNullable<
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
  >;
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
  TNextConfig = TConfig,
  TNextValue extends Promise<any> = TValue,
  TNextDeps extends DependencyMapType = TDeps,
  TNextContext = TContext,
  TNextMeta extends IResourceMeta = TMeta,
  TNextTags extends TagType[] = TTags,
  TNextMiddleware extends ResourceMiddlewareAttachmentType[] = TMiddleware,
>(
  s: BuilderState<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>,
  patch: Partial<
    BuilderState<
      TNextConfig,
      TNextValue,
      TNextDeps,
      TNextContext,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >
  >,
): BuilderState<
  TNextConfig,
  TNextValue,
  TNextDeps,
  TNextContext,
  TNextMeta,
  TNextTags,
  TNextMiddleware
> {
  return Object.freeze({
    // We reuse the frozen state while widening generics, hence the temporary cast.
    ...(s as unknown as BuilderState<
      TNextConfig,
      TNextValue,
      TNextDeps,
      TNextContext,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >),
    ...patch,
  }) as BuilderState<
    TNextConfig,
    TNextValue,
    TNextDeps,
    TNextContext,
    TNextMeta,
    TNextTags,
    TNextMiddleware
  >;
}

type ShouldReplaceConfig<T> = [T] extends [void]
  ? true
  : [T] extends [undefined]
  ? true
  : false;
type ResolveConfig<TExisting, TProposed> =
  ShouldReplaceConfig<TExisting> extends true ? TProposed : TExisting;

type RegisterInput<TConfig> =
  | RegisterableItems
  | Array<RegisterableItems>
  | ((config: TConfig) => RegisterableItems | Array<RegisterableItems>);

type RegisterState<TConfig> =
  | Array<RegisterableItems>
  | ((config: TConfig) => Array<RegisterableItems>)
  | undefined;

function toRegisterArray(items: RegisterableItems | Array<RegisterableItems>) {
  return Array.isArray(items) ? [...items] : [items];
}

function normalizeRegisterFunction<TConfig>(
  fn: (config: TConfig) => RegisterableItems | Array<RegisterableItems>,
) {
  return (config: TConfig) => toRegisterArray(fn(config));
}

function mergeRegister<TConfig>(
  existing: RegisterState<TConfig>,
  addition: RegisterInput<TConfig>,
  override: boolean,
): RegisterState<TConfig> {
  const isFunctionAddition = typeof addition === "function";
  const normalizedAddition = isFunctionAddition
    ? normalizeRegisterFunction(
        addition as (
          config: TConfig,
        ) => RegisterableItems | Array<RegisterableItems>,
      )
    : toRegisterArray(addition as RegisterableItems | Array<RegisterableItems>);

  if (override || !existing) {
    return isFunctionAddition
      ? (normalizedAddition as (config: TConfig) => Array<RegisterableItems>)
      : (normalizedAddition as Array<RegisterableItems>);
  }

  if (typeof existing === "function") {
    if (isFunctionAddition) {
      const additionFn = normalizedAddition as (
        config: TConfig,
      ) => Array<RegisterableItems>;
      return (config: TConfig) => [...existing(config), ...additionFn(config)];
    }
    const additionArray = normalizedAddition as Array<RegisterableItems>;
    return (config: TConfig) => [...existing(config), ...additionArray];
  }

  const existingArray = existing as Array<RegisterableItems>;
  if (isFunctionAddition) {
    const additionFn = normalizedAddition as (
      config: TConfig,
    ) => Array<RegisterableItems>;
    return (config: TConfig) => [...existingArray, ...additionFn(config)];
  }

  return [
    ...existingArray,
    ...(normalizedAddition as Array<RegisterableItems>),
  ];
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

function mergeDependencies<
  TConfig,
  TExisting extends DependencyMapType,
  TNew extends DependencyMapType,
>(
  existing: TExisting | ((config: TConfig) => TExisting) | undefined,
  addition: TNew | ((config: TConfig) => TNew),
  override: boolean,
): (TExisting & TNew) | ((config: TConfig) => TExisting & TNew) {
  const isFnExisting = typeof existing === "function";
  const isFnAddition = typeof addition === "function";

  if (override || !existing) {
    return addition as any as
      | (TExisting & TNew)
      | ((config: TConfig) => TExisting & TNew);
  }

  if (isFnExisting && isFnAddition) {
    const e = existing as (config: TConfig) => TExisting;
    const a = addition as (config: TConfig) => TNew;
    return ((config: TConfig) => ({
      ...(e(config) as any),
      ...(a(config) as any),
    })) as any;
  }
  if (isFnExisting && !isFnAddition) {
    const e = existing as (config: TConfig) => TExisting;
    const a = addition as TNew;
    return ((config: TConfig) => ({
      ...(e(config) as any),
      ...(a as any),
    })) as any;
  }
  if (!isFnExisting && isFnAddition) {
    const e = existing as TExisting;
    const a = addition as (config: TConfig) => TNew;
    return ((config: TConfig) => ({
      ...(e as any),
      ...(a(config) as any),
    })) as any;
  }
  const e = existing as TExisting;
  const a = addition as TNew;
  return { ...(e as any), ...(a as any) } as any;
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
  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: TConfig) => TNewDeps),
    options?: { override?: false },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps & TNewDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: TConfig) => TNewDeps),
    options: { override: true },
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
      | RegisterableItems
      | Array<RegisterableItems>
      | ((config: TConfig) => RegisterableItems | Array<RegisterableItems>),
    options?: { override?: boolean },
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
    options?: { override?: boolean },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TNewMw
  >;
  // Append signature (default)
  tags<TNewTags extends TagType[]>(
    tags: TNewTags,
    options?: { override?: false },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    [...TTags, ...TNewTags],
    TMiddleware
  >;
  // Override signature (replace)
  tags<TNewTags extends TagType[]>(
    tags: TNewTags,
    options: { override: true },
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
  init<TNewConfig = TConfig, TNewValue extends Promise<any> = TValue>(
    fn: ResourceInitFn<
      ResolveConfig<TConfig, TNewConfig>,
      TNewValue,
      TDeps,
      TContext,
      TMeta,
      TTags,
      TMiddleware
    >,
  ): ResourceFluentBuilder<
    ResolveConfig<TConfig, TNewConfig>,
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
    options?: { override?: boolean },
  ): ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;
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
  const builder: ResourceFluentBuilder<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  > = {
    id: state.id,
    dependencies<
      TNewDeps extends DependencyMapType,
      TIsOverride extends boolean = false,
    >(
      deps: TNewDeps | ((config: TConfig) => TNewDeps),
      options?: { override?: TIsOverride },
    ) {
      const override = options?.override ?? false;
      const next = clone<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        TConfig,
        TValue,
        any,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(state, {
        dependencies: mergeDependencies<TConfig, TDeps, TNewDeps>(
          state.dependencies as any,
          deps as any,
          override,
        ) as any,
      });
      if (override) {
        return makeResourceBuilder<
          TConfig,
          TValue,
          TNewDeps,
          TContext,
          TMeta,
          TTags,
          TMiddleware
        >(next as any);
      }
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps & TNewDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(next as any);
    },
    register(items, options) {
      const override = options?.override ?? false;
      const next = clone(state, {
        register: mergeRegister(state.register, items, override),
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
    middleware<TNewMw extends ResourceMiddlewareAttachmentType[]>(
      mw: TNewMw,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TNewMw
      >(state, {
        middleware: mergeArray(state.middleware, mw, override) as any,
      });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TNewMw
      >(next);
    },
    tags<TNewTags extends TagType[]>(tags: TNewTags, options?: { override?: boolean }) {
      const override = options?.override ?? false;
      const next = clone<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        [...TTags, ...TNewTags],
        TMiddleware
      >(state, { tags: mergeArray(state.tags, tags, override) as any });
      // Implementation is compatible with both overloads; cast to satisfy TS.
      return makeResourceBuilder(next as any) as any;
    },
    context<TNewCtx>(factory: () => TNewCtx) {
      const next = clone<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        TConfig,
        TValue,
        TDeps,
        TNewCtx,
        TMeta,
        TTags,
        TMiddleware
      >(state, { context: factory });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TNewCtx,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },
    configSchema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      const next = clone<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        TNewConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(state, { configSchema: schema });
      return makeResourceBuilder<
        TNewConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },
    resultSchema<TResolved>(schema: IValidationSchema<TResolved>) {
      const next = clone<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        TConfig,
        Promise<TResolved>,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(state, { resultSchema: schema });
      return makeResourceBuilder<
        TConfig,
        Promise<TResolved>,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },
    init<TNewConfig = TConfig, TNewValue extends Promise<any> = TValue>(
      fn: ResourceInitFn<
        ResolveConfig<TConfig, TNewConfig>,
        TNewValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >,
    ) {
      const next = clone<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        ResolveConfig<TConfig, TNewConfig>,
        TNewValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(state, { init: fn });
      return makeResourceBuilder<
        ResolveConfig<TConfig, TNewConfig>,
        TNewValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },
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
    ) {
      const next = clone(state, { dispose: fn });
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
      const next = clone<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        TConfig,
        TValue,
        TDeps,
        TContext,
        TNewMeta,
        TTags,
        TMiddleware
      >(state, { meta: m });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TNewMeta,
        TTags,
        TMiddleware
      >(next);
    },
    overrides(o: Array<OverridableElements>, options?: { override?: boolean }) {
      const override = options?.override ?? false;
      const next = clone(state, {
        overrides: mergeArray(state.overrides, o, override),
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
    build() {
      const definition: IResourceDefinition<
        TConfig,
        TValue,
        TDeps,
        TContext,
        any,
        any,
        TMeta,
        TTags,
        TMiddleware
      > = {
        id: state.id,
        dependencies: state.dependencies,
        register: state.register,
        middleware: state.middleware,
        tags: state.tags,
        context: state.context,
        init: state.init,
        dispose: state.dispose,
        configSchema: state.configSchema,
        resultSchema: state.resultSchema,
        meta: state.meta,
        overrides: state.overrides,
      };
      const resource = defineResource(definition);
      (resource as any)[symbolFilePath] = state.filePath;
      return resource;
    },
  };
  return builder;
}

// Overload allows callers to seed the config type at the entry point for convenience
export function resourceBuilder<TConfig = void>(
  id: string,
): ResourceFluentBuilder<
  TConfig,
  Promise<any>,
  {},
  any,
  IResourceMeta,
  TagType[],
  ResourceMiddlewareAttachmentType[]
>;

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
  const filePath = getCallerFile();
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
    filePath,
    dependencies: undefined,
    register: undefined,
    middleware: [],
    tags: [],
    context: undefined,
    init: undefined,
    dispose: undefined,
    configSchema: undefined,
    resultSchema: undefined,
    meta: undefined,
    overrides: undefined,
  });
  return makeResourceBuilder(initial);
}

export const resource = resourceBuilder;
