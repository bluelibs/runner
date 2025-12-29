import type {
  DependencyMapType,
  IResource,
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
  IValidationSchema,
  IMiddlewareMeta,
  TagType,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { defineResourceMiddleware } from "../../defineResourceMiddleware";
import type { ResourceMiddlewareFluentBuilder } from "./resource.interface";
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
>(
  state: ResMwState<C, In, Out, D>,
): ResourceMiddlewareFluentBuilder<C, In, Out, D> {
  const builder: ResourceMiddlewareFluentBuilder<C, In, Out, D> = {
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

      const next = cloneRes<C, In, Out, D & TNewDeps>(state as any, {
        dependencies: nextDependencies as unknown as D & TNewDeps,
      });

      if (override) {
        return makeResourceMiddlewareBuilder<C, In, Out, TNewDeps>(
          next as unknown as ResMwState<C, In, Out, TNewDeps>,
        );
      }
      return makeResourceMiddlewareBuilder<C, In, Out, D & TNewDeps>(next);
    },

    configSchema<TNew>(schema: IValidationSchema<TNew>) {
      const next = cloneRes<TNew, In, Out, D>(state as any, {
        configSchema: schema as any,
      });
      return makeResourceMiddlewareBuilder<TNew, In, Out, D>(next);
    },

    run(fn) {
      const next = cloneRes(state, { run: fn as any });
      return makeResourceMiddlewareBuilder<C, In, Out, D>(next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneRes(state, { meta: m as any });
      return makeResourceMiddlewareBuilder<C, In, Out, D>(next);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneRes(state, {
        tags: mergeArray(state.tags, t, override) as TagType[],
      });
      return makeResourceMiddlewareBuilder<C, In, Out, D>(next);
    },

    everywhere(flag) {
      const next = cloneRes(state, { everywhere: flag });
      return makeResourceMiddlewareBuilder<C, In, Out, D>(next);
    },

    build() {
      const middleware = defineResourceMiddleware({
        ...(state as unknown as IResourceMiddlewareDefinition<C, In, Out, D>),
      });
      (middleware as { [symbolFilePath]?: string })[symbolFilePath] =
        state.filePath;
      return middleware;
    },
  };

  return builder;
}
