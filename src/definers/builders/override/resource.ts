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
  WiringAccessPolicy,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import { normalizeThrows } from "../../../tools/throws";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineOverride } from "../../defineOverride";
import type { ResourceFluentBuilder } from "../resource/fluent-builder.interface";
import type { ResolveConfig } from "../resource/types";
import {
  mergeArray,
  mergeDependencies,
  mergeRegister,
} from "../resource/utils";

type AnyResource = IResource<any, any, any, any, any, any, any>;

type ResourceOverrideState<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
> = Readonly<
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
  >
>;

function cloneResourceState<
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
  state: ResourceOverrideState<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >,
  patch: Partial<
    ResourceOverrideState<
      TNextConfig,
      TNextValue,
      TNextDeps,
      TNextContext,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >
  >,
): ResourceOverrideState<
  TNextConfig,
  TNextValue,
  TNextDeps,
  TNextContext,
  TNextMeta,
  TNextTags,
  TNextMiddleware
> {
  return Object.freeze({
    ...(state as ResourceOverrideState<
      TNextConfig,
      TNextValue,
      TNextDeps,
      TNextContext,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >),
    ...patch,
  });
}

function makeResourceOverrideBuilder<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  base: AnyResource,
  state: ResourceOverrideState<
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
      const next = cloneResourceState<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        TConfig,
        TValue,
        TIsOverride extends true ? TNewDeps : TDeps & TNewDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(state, {
        dependencies: mergeDependencies(
          state.dependencies,
          deps,
          override,
        ) as TIsOverride extends true ? TNewDeps : TDeps & TNewDeps,
      });

      return makeResourceOverrideBuilder(base, next);
    },
    register(items, options) {
      const override = options?.override ?? false;
      const next = cloneResourceState(state, {
        register: mergeRegister(state.register, items, override),
      });
      return makeResourceOverrideBuilder(base, next);
    },
    middleware<TNewMw extends ResourceMiddlewareAttachmentType[]>(
      mw: TNewMw,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneResourceState<
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
        middleware: mergeArray(state.middleware, mw, override) as TNewMw,
      });
      return makeResourceOverrideBuilder(base, next);
    },
    tags<TNewTags extends TagType[]>(
      tags: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneResourceState<
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
      >(state, {
        tags: mergeArray(state.tags, tags, override) as [...TTags, ...TNewTags],
      });
      return makeResourceOverrideBuilder(base, next);
    },
    context<TNewCtx>(factory: () => TNewCtx) {
      const next = cloneResourceState<
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
      return makeResourceOverrideBuilder<
        TConfig,
        TValue,
        TDeps,
        TNewCtx,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },
    configSchema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      const next = cloneResourceState<
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
      return makeResourceOverrideBuilder<
        TNewConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },
    schema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      return builder.configSchema(schema);
    },
    resultSchema<TResolved>(schema: IValidationSchema<TResolved>) {
      const next = cloneResourceState<
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
      return makeResourceOverrideBuilder<
        TConfig,
        Promise<TResolved>,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
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
      const next = cloneResourceState<
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
      return makeResourceOverrideBuilder<
        ResolveConfig<TConfig, TNewConfig>,
        TNewValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
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
      const next = cloneResourceState(state, { dispose: fn });
      return makeResourceOverrideBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },
    meta<TNewMeta extends IResourceMeta>(m: TNewMeta) {
      const next = cloneResourceState<
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
      return makeResourceOverrideBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TNewMeta,
        TTags,
        TMiddleware
      >(base, next);
    },
    overrides(o: Array<OverridableElements>, options?: { override?: boolean }) {
      const override = options?.override ?? false;
      const next = cloneResourceState(state, {
        overrides: mergeArray(state.overrides, o, override),
      });
      return makeResourceOverrideBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },
    throws(list: ThrowsList) {
      const next = cloneResourceState(state, { throws: list });
      return makeResourceOverrideBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },
    exports(items: Array<RegisterableItems>, options?: { override?: boolean }) {
      const override = options?.override ?? false;
      const next = cloneResourceState(state, {
        exports: mergeArray(state.exports ?? [], items, override),
      });
      return makeResourceOverrideBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },
    wiringAccessPolicy(policy: WiringAccessPolicy) {
      const existing = state.wiringAccessPolicy?.deny ?? [];
      const next = cloneResourceState(state, {
        wiringAccessPolicy: {
          deny: [...existing, ...policy.deny],
        },
      });
      return makeResourceOverrideBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware
      >(base, next);
    },
    build() {
      const normalizedThrows = normalizeThrows(
        { kind: "resource", id: state.id },
        state.throws,
      );
      const { id: _id, ...patch } = state;
      return deepFreeze(
        defineOverride<
          IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>
        >(base, { ...patch, throws: normalizedThrows }),
      );
    },
  };
  return builder;
}

export function resourceOverrideBuilder<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  base: IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>,
): ResourceFluentBuilder<
  TConfig,
  TValue,
  TDeps,
  TContext,
  TMeta,
  TTags,
  TMiddleware
> {
  const initial: ResourceOverrideState<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  > = Object.freeze({
    id: base.id,
    dependencies: base.dependencies,
    register: base.register,
    middleware: base.middleware,
    tags: base.tags,
    context: base.context,
    init: base.init,
    dispose: base.dispose,
    configSchema: base.configSchema,
    resultSchema: base.resultSchema,
    meta: base.meta,
    overrides: base.overrides,
    throws: base.throws,
    exports: base.exports,
    wiringAccessPolicy: base.wiringAccessPolicy,
  });

  return makeResourceOverrideBuilder(base, initial);
}
