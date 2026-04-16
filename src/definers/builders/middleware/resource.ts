import type {
  DependencyMapType,
  EnsureTagsForTarget,
  ResolveValidationSchemaInput,
  IResourceMiddlewareDefinition,
  IMiddlewareMeta,
  ResourceMiddlewareTagType,
  ValidationSchemaInput,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import type { ThrowsList } from "../../../types/error";
import { builderIncompleteError } from "../../../errors";
import { defineResourceMiddleware } from "../../defineResourceMiddleware";
import type {
  ResourceMiddlewareFluentBuilder,
  ResourceMiddlewareFluentBuilderAfterRun,
  ResourceMiddlewareFluentBuilderBeforeRun,
} from "./resource.interface";
import type {
  ReplaceResMwStateConfig,
  ReplaceResMwStateDeps,
  ReplaceResMwStateTags,
  ResMwState,
} from "./types";
import { cloneRes, mergeArray, mergeDependencies } from "./utils";

/**
 * Creates a ResourceMiddlewareFluentBuilder from the given state.
 */
export function makeResourceMiddlewareBuilder<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends ResourceMiddlewareTagType[],
  THasRun extends boolean = false,
>(
  state: ResMwState<C, In, Out, D, TTags>,
): ResourceMiddlewareFluentBuilder<C, In, Out, D, TTags, THasRun> {
  const builder = {
    id: state.id,

    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | ((config: C) => TNewDeps),
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const nextDependencies = mergeDependencies<C, D, TNewDeps>(
        state.dependencies as D | ((config: C) => D),
        deps,
        override,
      );

      const next = cloneRes<
        typeof state,
        ReplaceResMwStateDeps<typeof state, D & TNewDeps>
      >(state, {
        dependencies: nextDependencies as D & TNewDeps,
      });

      if (override) {
        const overridden = cloneRes<
          typeof next,
          ReplaceResMwStateDeps<typeof next, TNewDeps>
        >(next, {
          dependencies: nextDependencies as TNewDeps,
        });
        return makeResourceMiddlewareBuilder<
          C,
          In,
          Out,
          TNewDeps,
          TTags,
          false
        >(overridden);
      }
      return makeResourceMiddlewareBuilder<
        C,
        In,
        Out,
        D & TNewDeps,
        TTags,
        false
      >(next);
    },

    configSchema<
      TNew = never,
      TSchema extends ValidationSchemaInput<
        [TNew] extends [never] ? any : TNew
      > = ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
    >(schema: TSchema) {
      const next = cloneRes<
        typeof state,
        ReplaceResMwStateConfig<
          typeof state,
          ResolveValidationSchemaInput<TNew, TSchema>
        >
      >(state, {
        configSchema: schema,
      });
      return makeResourceMiddlewareBuilder<
        ResolveValidationSchemaInput<TNew, TSchema>,
        In,
        Out,
        D,
        TTags,
        false
      >(next);
    },

    schema<
      TNew = never,
      TSchema extends ValidationSchemaInput<
        [TNew] extends [never] ? any : TNew
      > = ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
    >(schema: TSchema) {
      return builder.configSchema(schema);
    },

    run(fn: IResourceMiddlewareDefinition<C, In, Out, D, TTags>["run"]) {
      const next = cloneRes(state, { run: fn as typeof state.run });
      return makeResourceMiddlewareBuilder<C, In, Out, D, TTags, true>(next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneRes(state, { meta: m as IMiddlewareMeta });
      return makeResourceMiddlewareBuilder<C, In, Out, D, TTags, THasRun>(next);
    },

    tags<TNewTags extends ResourceMiddlewareTagType[]>(
      t: EnsureTagsForTarget<"resourceMiddlewares", TNewTags>,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      if (override) {
        const nextTags = mergeArray(state.tags, t, true) as TNewTags;
        const next = cloneRes<
          typeof state,
          ReplaceResMwStateTags<typeof state, TNewTags>
        >(state, {
          tags: nextTags,
        });
        return makeResourceMiddlewareBuilder<C, In, Out, D, TNewTags, false>(
          next,
        );
      }

      const nextTags = mergeArray(state.tags, t, false) as [
        ...TTags,
        ...TNewTags,
      ];
      const next = cloneRes<
        typeof state,
        ReplaceResMwStateTags<typeof state, [...TTags, ...TNewTags]>
      >(state, {
        tags: nextTags,
      });
      return makeResourceMiddlewareBuilder<
        C,
        In,
        Out,
        D,
        [...TTags, ...TNewTags],
        false
      >(next);
    },

    throws(list: ThrowsList) {
      const next = cloneRes(state, { throws: list });
      return makeResourceMiddlewareBuilder<C, In, Out, D, TTags, THasRun>(next);
    },

    build() {
      // Fail-fast: validate required fields before creating middleware
      if (state.run === undefined) {
        builderIncompleteError.throw({
          type: "resource-middleware",
          builderId: state.id,
          missingFields: ["run"],
          message: `Resource middleware "${state.id}" is incomplete`,
        });
      }

      const middleware = defineResourceMiddleware({
        ...(state as IResourceMiddlewareDefinition<C, In, Out, D, TTags>),
      });
      return deepFreeze({
        ...middleware,
        [symbolFilePath]: state.filePath,
      });
    },
  };

  return builder as ResourceMiddlewareFluentBuilderBeforeRun<
    C,
    In,
    Out,
    D,
    TTags
  > &
    ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags> &
    ResourceMiddlewareFluentBuilder<C, In, Out, D, TTags, THasRun>;
}
