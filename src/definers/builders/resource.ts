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
  // Overload 1: object style ({ config, deps, ctx }) => Promise<...>
  init<TNewValue extends Promise<any>>(
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
  // Overload 2: traditional (config, deps, ctx) => Promise<...>
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
    register(items, options) {
      const override = options?.override ?? false;
      const next = clone(state, {
        register: mergeRegister(state.register, items, override) as any,
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
    init<TNewValue extends Promise<any>>(fn: any) {
      const wrapped = (
        config: unknown,
        dependencies: unknown,
        context: unknown,
      ) => {
        if ((fn as any).length >= 3) {
          return fn(config, dependencies, context);
        }
        const src = Function.prototype.toString.call(fn);
        const match = src.match(/^[^(]*\(([^)]*)\)/);
        let params = "";
        if (match) {
          params = match[1];
        }
        const looksDestructured = params.includes("{");
        if (looksDestructured) {
          return fn({ config, deps: dependencies, ctx: context });
        }
        return fn(config);
      };
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
  return makeResourceBuilder(initial) as any;
}

export const resource = resourceBuilder;
