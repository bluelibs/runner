import type {
  DependencyMapType,
  IResourceDefinition,
  IResourceMeta,
  IValidationSchema,
  OverridableElements,
  ResourceInitFn,
  ResourceMiddlewareAttachmentType,
  TagType,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import { defineResource } from "../../defineResource";
import type { ResourceFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState, ResolveConfig } from "./types";
import { clone, mergeArray, mergeDependencies, mergeRegister } from "./utils";

/**
 * Creates a ResourceFluentBuilder from the given state.
 * Each builder method returns a new builder with updated state.
 */
export function makeResourceBuilder<
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
        ) as unknown as TIsOverride extends true ? TNewDeps : TDeps & TNewDeps,
      });

      return makeResourceBuilder(next);
    },
    register(items, options) {
      const override = options?.override ?? false;
      const next = clone(state, {
        register: mergeRegister(state.register, items, override),
      });
      return makeResourceBuilder(next);
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
        middleware: mergeArray(state.middleware, mw, override) as TNewMw,
      });
      return makeResourceBuilder(next);
    },
    tags<TNewTags extends TagType[]>(
      tags: TNewTags,
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
        [...TTags, ...TNewTags],
        TMiddleware
      >(state, { tags: mergeArray(state.tags, tags, override) as unknown as [...TTags, ...TNewTags] });
      return makeResourceBuilder(next);
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
    throws(list: ThrowsList) {
      const next = clone(state, { throws: list });
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
        throws: state.throws,
      };
      const resource = defineResource(definition);
      (resource as { [symbolFilePath]?: string })[symbolFilePath] = state.filePath;
      return resource;
    },
  };
  return builder;
}
