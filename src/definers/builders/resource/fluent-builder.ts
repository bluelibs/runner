import type {
  DependencyMapType,
  EnsureTagsForTarget,
  IResourceDefinition,
  IResourceMeta,
  IsolationPolicyInput,
  OverridableElements,
  RegisterableItems,
  ResourceInitFn,
  ResourceMiddlewareAttachmentType,
  ResourceSubtreePolicyInput,
  ResourceTagType,
  TagType,
  ValidationSchemaInput,
} from "../../../defs";
import {
  symbolFilePath,
  symbolResourceIsolateDeclarations,
  symbolResourceSubtreeDeclarations,
} from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import type { ThrowsList } from "../../../types/error";
import { defineResource } from "../../defineResource";
import type {
  ResourceFluentBuilder,
  ResourceFluentBuilderAfterInit,
  ResourceFluentBuilderBeforeInit,
} from "./fluent-builder.interface";
import type { BuilderState, ResolveConfig } from "./types";
import { clone, mergeArray, mergeDependencies, mergeRegister } from "./utils";
import {
  createDisplaySubtreePolicy,
  mergeResourceSubtreeDeclarations,
} from "../../subtreePolicy";
import {
  assertIsolationConflict,
  createDisplayIsolatePolicy,
  mergeIsolatePolicyDeclarations,
} from "../../isolatePolicy";

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
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
  THasInit extends boolean = false,
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
  TMiddleware,
  THasInit
> {
  const builder = {
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
        ) as TIsOverride extends true ? TNewDeps : TDeps & TNewDeps,
      });

      return makeResourceBuilder<
        TConfig,
        TValue,
        TIsOverride extends true ? TNewDeps : TDeps & TNewDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        false
      >(next);
    },
    register(
      items:
        | RegisterableItems
        | Array<RegisterableItems>
        | ((config: TConfig) => RegisterableItems | Array<RegisterableItems>),
      options?: { override?: boolean },
    ) {
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
        TMiddleware,
        THasInit
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
        middleware: mergeArray(state.middleware, mw, override) as TNewMw,
      });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TNewMw,
        false
      >(next);
    },
    tags<const TNewTags extends TagType[]>(
      tags: EnsureTagsForTarget<"resources", TNewTags>,
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
      >(state, {
        tags: mergeArray(state.tags, tags, override) as [...TTags, ...TNewTags],
      });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        [...TTags, ...TNewTags],
        TMiddleware,
        false
      >(next);
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
        TMiddleware,
        false
      >(next);
    },
    configSchema<TNewConfig>(schema: ValidationSchemaInput<TNewConfig>) {
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
        TMiddleware,
        false
      >(next);
    },
    schema<TNewConfig>(schema: ValidationSchemaInput<TNewConfig>) {
      return builder.configSchema(schema);
    },
    resultSchema<TResolved>(schema: ValidationSchemaInput<TResolved>) {
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
        TMiddleware,
        false
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
        TMiddleware,
        true
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
        TMiddleware,
        THasInit
      >(next);
    },
    ready(
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
        >["ready"]
      >,
    ) {
      const next = clone(state, { ready: fn });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        THasInit
      >(next);
    },
    cooldown(
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
        >["cooldown"]
      >,
    ) {
      const next = clone(state, { cooldown: fn });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        THasInit
      >(next);
    },
    health(
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
        >["health"]
      >,
    ) {
      const next = clone(state, { health: fn });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        THasInit
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
        TMiddleware,
        THasInit
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
        TMiddleware,
        THasInit
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
        TMiddleware,
        THasInit
      >(next);
    },
    isolate(
      policy: IsolationPolicyInput<TConfig>,
      options?: { override?: boolean },
    ) {
      const existingDisplayPolicy = createDisplayIsolatePolicy(
        state.isolateDeclarations,
        state.id,
      );

      if (
        typeof existingDisplayPolicy !== "function" &&
        typeof policy !== "function"
      ) {
        assertIsolationConflict(
          state.id,
          existingDisplayPolicy,
          policy,
          options,
        );
      }

      const next = clone(state, {
        isolateDeclarations: mergeIsolatePolicyDeclarations(
          state.isolateDeclarations,
          policy,
          options,
        ),
      });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        THasInit
      >(next);
    },
    subtree(
      policy: ResourceSubtreePolicyInput<TConfig>,
      options?: { override?: boolean },
    ) {
      const next = clone(state, {
        subtreeDeclarations: mergeResourceSubtreeDeclarations(
          state.subtreeDeclarations,
          policy,
          options,
        ),
      });
      return makeResourceBuilder<
        TConfig,
        TValue,
        TDeps,
        TContext,
        TMeta,
        TTags,
        TMiddleware,
        THasInit
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
        gateway: state.gateway,
        dependencies: state.dependencies,
        register: state.register,
        middleware: state.middleware,
        tags: state.tags,
        context: state.context,
        init: state.init,
        dispose: state.dispose,
        ready: state.ready,
        cooldown: state.cooldown,
        health: state.health,
        configSchema: state.configSchema,
        resultSchema: state.resultSchema,
        meta: state.meta,
        overrides: state.overrides,
        throws: state.throws,
        isolate: createDisplayIsolatePolicy(
          state.isolateDeclarations,
          state.id,
        ),
        subtree: createDisplaySubtreePolicy(state.subtreeDeclarations),
        [symbolResourceIsolateDeclarations]: state.isolateDeclarations,
        [symbolResourceSubtreeDeclarations]: state.subtreeDeclarations,
      };
      const resource = defineResource(definition);
      return deepFreeze({
        ...resource,
        [symbolFilePath]: state.filePath,
      });
    },
  };
  return builder as ResourceFluentBuilderBeforeInit<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  > &
    ResourceFluentBuilderAfterInit<
      TConfig,
      TValue,
      TDeps,
      TContext,
      TMeta,
      TTags,
      TMiddleware
    > &
    ResourceFluentBuilder<
      TConfig,
      TValue,
      TDeps,
      TContext,
      TMeta,
      TTags,
      TMiddleware,
      THasInit
    >;
}
