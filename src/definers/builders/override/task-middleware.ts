import type {
  DependencyMapType,
  IMiddlewareMeta,
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  IValidationSchema,
  TagType,
} from "../../../defs";
import { defineOverride } from "../../defineOverride";
import type { TaskMiddlewareFluentBuilder } from "../middleware/task.interface";
import { mergeArray, mergeDependencies } from "../middleware/utils";

type TaskMiddlewareOverrideState<
  C,
  In,
  Out,
  D extends DependencyMapType,
> = Readonly<ITaskMiddlewareDefinition<C, In, Out, D>>;

function cloneTaskMiddlewareState<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TNextConfig = C,
  TNextIn = In,
  TNextOut = Out,
  TNextDeps extends DependencyMapType = D,
>(
  state: TaskMiddlewareOverrideState<C, In, Out, D>,
  patch: Partial<
    TaskMiddlewareOverrideState<TNextConfig, TNextIn, TNextOut, TNextDeps>
  >,
): TaskMiddlewareOverrideState<TNextConfig, TNextIn, TNextOut, TNextDeps> {
  return Object.freeze({
    ...(state as unknown as TaskMiddlewareOverrideState<
      TNextConfig,
      TNextIn,
      TNextOut,
      TNextDeps
    >),
    ...patch,
  });
}

function makeTaskMiddlewareOverrideBuilder<
  C,
  In,
  Out,
  D extends DependencyMapType,
>(
  base: ITaskMiddleware<C, In, Out, D>,
  state: TaskMiddlewareOverrideState<C, In, Out, D>,
): TaskMiddlewareFluentBuilder<C, In, Out, D> {
  const builder: TaskMiddlewareFluentBuilder<C, In, Out, D> = {
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

      const next = cloneTaskMiddlewareState<C, In, Out, D & TNewDeps>(
        state as unknown as TaskMiddlewareOverrideState<
          C,
          In,
          Out,
          D & TNewDeps
        >,
        {
          dependencies: nextDependencies as unknown as D & TNewDeps,
        },
      );

      if (override) {
        return makeTaskMiddlewareOverrideBuilder<C, In, Out, TNewDeps>(
          base as any,
          next as TaskMiddlewareOverrideState<C, In, Out, TNewDeps>,
        );
      }
      return makeTaskMiddlewareOverrideBuilder<C, In, Out, D & TNewDeps>(
        base as any,
        next,
      );
    },

    configSchema<TNew>(schema: IValidationSchema<TNew>) {
      const next = cloneTaskMiddlewareState<TNew, In, Out, D>(
        state as unknown as TaskMiddlewareOverrideState<TNew, In, Out, D>,
        { configSchema: schema },
      );
      return makeTaskMiddlewareOverrideBuilder<TNew, In, Out, D>(
        base as any,
        next,
      );
    },

    run(fn) {
      const next = cloneTaskMiddlewareState(state, { run: fn });
      return makeTaskMiddlewareOverrideBuilder(base as any, next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneTaskMiddlewareState(state, { meta: m });
      return makeTaskMiddlewareOverrideBuilder(base as any, next);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneTaskMiddlewareState(state, {
        tags: mergeArray(state.tags, t, override) as TagType[],
      });
      return makeTaskMiddlewareOverrideBuilder(base as any, next);
    },

    everywhere(flag) {
      const next = cloneTaskMiddlewareState(state, { everywhere: flag });
      return makeTaskMiddlewareOverrideBuilder(base as any, next);
    },

    build() {
      const { id: _id, ...patch } = state;
      return defineOverride(base, patch as any);
    },
  };

  return builder;
}

export function taskMiddlewareOverrideBuilder<
  C,
  In,
  Out,
  D extends DependencyMapType,
>(
  base: ITaskMiddleware<C, In, Out, D>,
): TaskMiddlewareFluentBuilder<C, In, Out, D> {
  const initial: TaskMiddlewareOverrideState<C, In, Out, D> = Object.freeze({
    id: base.id,
    dependencies: base.dependencies,
    configSchema: base.configSchema,
    run: base.run,
    meta: base.meta,
    tags: base.tags,
    everywhere: base.everywhere,
  });

  return makeTaskMiddlewareOverrideBuilder(base, initial);
}
