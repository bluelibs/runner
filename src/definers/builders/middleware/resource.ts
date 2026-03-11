import type {
  DependencyMapType,
  EnsureTagsForTarget,
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
import type { ResMwState } from "./types";
import { cloneRes, mergeArray, mergeDependencies } from "./utils";

/**
 * Creates a ResourceMiddlewareFluentBuilder from the given state.
 */
export function makeResourceMiddlewareBuilder<
  C,
  In,
  Out,
  D extends DependencyMapType,
  THasRun extends boolean = false,
>(
  state: ResMwState<C, In, Out, D>,
): ResourceMiddlewareFluentBuilder<C, In, Out, D, THasRun> {
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

      const next = cloneRes<C, In, Out, D, C, In, Out, D & TNewDeps>(state, {
        dependencies: nextDependencies as D & TNewDeps,
      });

      if (override) {
        const overridden = cloneRes<
          C,
          In,
          Out,
          D & TNewDeps,
          C,
          In,
          Out,
          TNewDeps
        >(next, {
          dependencies: nextDependencies as TNewDeps,
        });
        return makeResourceMiddlewareBuilder<C, In, Out, TNewDeps, false>(
          overridden,
        );
      }
      return makeResourceMiddlewareBuilder<C, In, Out, D & TNewDeps, false>(
        next,
      );
    },

    configSchema<TNew>(schema: ValidationSchemaInput<TNew>) {
      const next = cloneRes<C, In, Out, D, TNew, In, Out, D>(state, {
        configSchema: schema,
      });
      return makeResourceMiddlewareBuilder<TNew, In, Out, D, false>(next);
    },

    schema<TNew>(schema: ValidationSchemaInput<TNew>) {
      return builder.configSchema(schema);
    },

    run(fn: IResourceMiddlewareDefinition<C, In, Out, D>["run"]) {
      const next = cloneRes(state, { run: fn as typeof state.run });
      return makeResourceMiddlewareBuilder<C, In, Out, D, true>(next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneRes(state, { meta: m as IMiddlewareMeta });
      return makeResourceMiddlewareBuilder<C, In, Out, D, THasRun>(next);
    },

    tags<TNewTags extends ResourceMiddlewareTagType[]>(
      t: EnsureTagsForTarget<"resourceMiddlewares", TNewTags>,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneRes(state, {
        tags: mergeArray(
          state.tags,
          t,
          override,
        ) as ResourceMiddlewareTagType[],
      });
      return makeResourceMiddlewareBuilder<C, In, Out, D, false>(next);
    },

    throws(list: ThrowsList) {
      const next = cloneRes(state, { throws: list });
      return makeResourceMiddlewareBuilder<C, In, Out, D, THasRun>(next);
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
        ...(state as IResourceMiddlewareDefinition<C, In, Out, D>),
      });
      return deepFreeze({
        ...middleware,
        [symbolFilePath]: state.filePath,
      });
    },
  };

  return builder as ResourceMiddlewareFluentBuilderBeforeRun<C, In, Out, D> &
    ResourceMiddlewareFluentBuilderAfterRun<C, In, Out, D> &
    ResourceMiddlewareFluentBuilder<C, In, Out, D, THasRun>;
}
