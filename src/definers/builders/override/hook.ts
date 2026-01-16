import type {
  DependencyMapType,
  IHook,
  IHookDefinition,
  ITaskMeta,
  TagType,
} from "../../../defs";
import { defineOverride } from "../../defineOverride";
import { mergeArray, mergeDependencies } from "../hook/utils";

// Relaxing generic constraint to allow any kind of event definition or strict string
export type HookOn = any;

export interface HookOverrideBuilder<
  TDeps extends DependencyMapType,
  TOn extends HookOn,
  TMeta extends ITaskMeta,
> {
  id: string;
  order(order: number): HookOverrideBuilder<TDeps, TOn, TMeta>;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: boolean },
  ): HookOverrideBuilder<TDeps & TNewDeps, TOn, TMeta>;
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options?: { override?: boolean },
  ): HookOverrideBuilder<TDeps, TOn, TMeta>;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): HookOverrideBuilder<TDeps, TOn, TNewMeta>;
  run(
    fn: IHookDefinition<TDeps, TOn, TMeta>["run"],
  ): HookOverrideBuilder<TDeps, TOn, TMeta>;
  build(): IHook<TDeps, TOn, TMeta>;
}

type HookOverrideState<
  TDeps extends DependencyMapType,
  TOn extends HookOn,
  TMeta extends ITaskMeta,
> = Readonly<IHookDefinition<TDeps, TOn, TMeta>>;

function cloneHookState<
  TDeps extends DependencyMapType,
  TOn extends IHookDefinition<any, any, any>["on"],
  TMeta extends ITaskMeta,
  TNextDeps extends DependencyMapType = TDeps,
  TNextOn extends HookOn = TOn,
  TNextMeta extends ITaskMeta = TMeta,
>(
  state: HookOverrideState<TDeps, TOn, TMeta>,
  patch: Partial<HookOverrideState<TNextDeps, TNextOn, TNextMeta>>,
): HookOverrideState<TNextDeps, TNextOn, TNextMeta> {
  return Object.freeze({
    ...(state as unknown as HookOverrideState<TNextDeps, TNextOn, TNextMeta>),
    ...patch,
  });
}

function makeHookOverrideBuilder<
  TDeps extends DependencyMapType,
  TOn extends HookOn,
  TMeta extends ITaskMeta,
>(
  base: IHook<TDeps, TOn, TMeta>,
  state: HookOverrideState<TDeps, TOn, TMeta>,
): HookOverrideBuilder<TDeps, TOn, TMeta> {
  const builder: HookOverrideBuilder<TDeps, TOn, TMeta> = {
    id: state.id,

    order(order: number) {
      const next = cloneHookState(state, { order });
      return makeHookOverrideBuilder(base as any, next);
    },

    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | (() => TNewDeps),
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const nextDependencies = mergeDependencies<TDeps, TNewDeps>(
        state.dependencies as TDeps | (() => TDeps),
        deps,
        override,
      );

      const next = cloneHookState<TDeps, TOn, TMeta, TDeps & TNewDeps>(
        state as HookOverrideState<TDeps, TOn, TMeta>,
        {
          dependencies: nextDependencies as unknown as TDeps & TNewDeps,
        },
      );

      if (override) {
        return makeHookOverrideBuilder<TNewDeps, TOn, TMeta>(
          base as any,
          next as HookOverrideState<TNewDeps, TOn, TMeta>,
        ) as any;
      }
      return makeHookOverrideBuilder<TDeps & TNewDeps, TOn, TMeta>(
        base as any,
        next,
      );
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneHookState(state, {
        tags: mergeArray(state.tags, t, override) as TagType[],
      });
      return makeHookOverrideBuilder(base as any, next);
    },

    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = cloneHookState<TDeps, TOn, TMeta, TDeps, TOn, TNewMeta>(
        state as HookOverrideState<TDeps, TOn, TMeta>,
        {
          meta: m,
        },
      );
      return makeHookOverrideBuilder<TDeps, TOn, TNewMeta>(base as any, next);
    },

    run(fn) {
      const next = cloneHookState(state, { run: fn });
      return makeHookOverrideBuilder(base as any, next);
    },

    build() {
      const { id: _id, on: _on, ...patch } = state;
      return defineOverride(base, patch as any);
    },
  };

  return builder;
}

export function hookOverrideBuilder<
  TDeps extends DependencyMapType,
  TOn extends HookOn,
  TMeta extends ITaskMeta,
>(base: IHook<TDeps, TOn, TMeta>): HookOverrideBuilder<TDeps, TOn, TMeta> {
  const initial: HookOverrideState<TDeps, TOn, TMeta> = Object.freeze({
    id: base.id,
    dependencies: base.dependencies,
    on: base.on,
    order: base.order,
    meta: base.meta,
    run: base.run,
    tags: base.tags,
  });

  return makeHookOverrideBuilder(base, initial);
}
