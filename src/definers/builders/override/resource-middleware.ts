import type {
  DependencyMapType,
  IMiddlewareMeta,
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
  IValidationSchema,
  TagType,
} from "../../../defs";
import { defineOverride } from "../../defineOverride";
import type { ResourceMiddlewareFluentBuilder } from "../middleware/resource.interface";
import { mergeArray, mergeDependencies } from "../middleware/utils";
import type { ThrowsList } from "../../../types/error";
import { deepFreeze } from "../../../tools/deepFreeze";
import { normalizeThrows } from "../../../tools/throws";

type AnyResourceMiddleware = IResourceMiddleware<any, any, any, any>;

type ResourceMiddlewareOverrideState<
  C,
  In,
  Out,
  D extends DependencyMapType,
> = Readonly<{
  id: string;
  dependencies: D | ((config: C) => D);
  configSchema: IValidationSchema<C> | undefined;
  run: IResourceMiddlewareDefinition<any, In, Out, any>["run"];
  meta?: IMiddlewareMeta;
  tags?: TagType[];
  everywhere?: IResourceMiddlewareDefinition<C, In, Out, D>["everywhere"];
  throws?: ThrowsList;
}>;

function cloneResourceMiddlewareState<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TNextConfig = C,
  TNextIn = In,
  TNextOut = Out,
  TNextDeps extends DependencyMapType = D,
>(
  state: ResourceMiddlewareOverrideState<C, In, Out, D>,
  patch: Partial<
    ResourceMiddlewareOverrideState<TNextConfig, TNextIn, TNextOut, TNextDeps>
  >,
): ResourceMiddlewareOverrideState<TNextConfig, TNextIn, TNextOut, TNextDeps> {
  const next = {
    ...state,
    ...patch,
  } as ResourceMiddlewareOverrideState<
    TNextConfig,
    TNextIn,
    TNextOut,
    TNextDeps
  >;
  return Object.freeze(next);
}

function makeResourceMiddlewareOverrideBuilder<
  C,
  In,
  Out,
  D extends DependencyMapType,
>(
  base: AnyResourceMiddleware,
  state: ResourceMiddlewareOverrideState<C, In, Out, D>,
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

      const next = cloneResourceMiddlewareState<
        C,
        In,
        Out,
        D,
        C,
        In,
        Out,
        D & TNewDeps
      >(state, {
        dependencies: nextDependencies as D & TNewDeps,
      });

      if (override) {
        const overridden = cloneResourceMiddlewareState<
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
        return makeResourceMiddlewareOverrideBuilder<C, In, Out, TNewDeps>(
          base,
          overridden,
        );
      }
      return makeResourceMiddlewareOverrideBuilder<C, In, Out, D & TNewDeps>(
        base,
        next,
      );
    },

    configSchema<TNew>(schema: IValidationSchema<TNew>) {
      const next = cloneResourceMiddlewareState<
        C,
        In,
        Out,
        D,
        TNew,
        In,
        Out,
        D
      >(state, { configSchema: schema });
      return makeResourceMiddlewareOverrideBuilder<TNew, In, Out, D>(
        base,
        next,
      );
    },

    schema<TNew>(schema: IValidationSchema<TNew>) {
      return builder.configSchema(schema);
    },

    run(fn) {
      const next = cloneResourceMiddlewareState(state, { run: fn });
      return makeResourceMiddlewareOverrideBuilder(base, next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneResourceMiddlewareState(state, { meta: m });
      return makeResourceMiddlewareOverrideBuilder(base, next);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneResourceMiddlewareState(state, {
        tags: mergeArray(state.tags, t, override) as TagType[],
      });
      return makeResourceMiddlewareOverrideBuilder(base, next);
    },

    everywhere(flag) {
      const next = cloneResourceMiddlewareState(state, { everywhere: flag });
      return makeResourceMiddlewareOverrideBuilder(base, next);
    },

    throws(list: ThrowsList) {
      const next = cloneResourceMiddlewareState(state, { throws: list });
      return makeResourceMiddlewareOverrideBuilder(base, next);
    },

    build() {
      const normalizedThrows = normalizeThrows(
        { kind: "resource-middleware", id: state.id },
        state.throws,
      );
      const { id: _id, ...patch } = state;
      return deepFreeze(
        defineOverride<IResourceMiddleware<C, In, Out, D>>(base, {
          ...patch,
          throws: normalizedThrows,
        }),
      );
    },
  };

  return builder;
}

export function resourceMiddlewareOverrideBuilder<
  C,
  In,
  Out,
  D extends DependencyMapType,
>(
  base: IResourceMiddleware<C, In, Out, D>,
): ResourceMiddlewareFluentBuilder<C, In, Out, D> {
  const initial: ResourceMiddlewareOverrideState<C, In, Out, D> = Object.freeze(
    {
      id: base.id,
      dependencies: base.dependencies,
      configSchema: base.configSchema,
      run: base.run,
      meta: base.meta,
      tags: base.tags,
      everywhere: base.everywhere,
      throws: base.throws,
    },
  );

  return makeResourceMiddlewareOverrideBuilder(base, initial);
}
