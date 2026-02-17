import type {
  DependencyMapType,
  IEventDefinition,
  IHook,
  IHookDefinition,
  ITaskMeta,
  TagType,
} from "../../../defs";
import { defineOverride } from "../../defineOverride";
import { mergeArray, mergeDependencies } from "../hook/utils";
import type { ThrowsList } from "../../../types/error";
import { normalizeThrows } from "../../../tools/throws";

export type HookOn =
  | "*"
  | IEventDefinition<any>
  | readonly IEventDefinition<any>[];

export interface HookOverrideBuilder<
  TDeps extends DependencyMapType,
  TOn extends HookOn,
  TMeta extends ITaskMeta,
> {
  id: string;
  order(order: number): HookOverrideBuilder<TDeps, TOn, TMeta>;
  dependencies<
    TNewDeps extends DependencyMapType,
    TIsOverride extends boolean = false,
  >(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: TIsOverride },
  ): HookOverrideBuilder<
    TIsOverride extends true ? TNewDeps : TDeps & TNewDeps,
    TOn,
    TMeta
  >;
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
  /** Declare which typed errors this hook may throw (declarative only). */
  throws(list: ThrowsList): HookOverrideBuilder<TDeps, TOn, TMeta>;
  build(): IHook<TDeps, TOn, TMeta>;
}

type HookOverrideState<
  TDeps extends DependencyMapType,
  TOn extends HookOn,
  TMeta extends ITaskMeta,
> = Readonly<IHookDefinition<TDeps, TOn, TMeta>>;

type AnyHook = IHook<any, any, any>;

function cloneHookState<
  TDeps extends DependencyMapType,
  TOn extends HookOn,
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
  base: AnyHook,
  state: HookOverrideState<TDeps, TOn, TMeta>,
): HookOverrideBuilder<TDeps, TOn, TMeta> {
  const builder: HookOverrideBuilder<TDeps, TOn, TMeta> = {
    id: state.id,

    order(order: number) {
      const next = cloneHookState(state, { order });
      return makeHookOverrideBuilder(base, next);
    },

    dependencies<
      TNewDeps extends DependencyMapType,
      TIsOverride extends boolean = false,
    >(deps: TNewDeps | (() => TNewDeps), options?: { override?: TIsOverride }) {
      type NextDeps = TIsOverride extends true ? TNewDeps : TDeps & TNewDeps;
      const override = options?.override ?? false;
      const nextDependencies = mergeDependencies<TDeps, TNewDeps>(
        state.dependencies as TDeps | (() => TDeps),
        deps,
        override,
      );

      const next = cloneHookState<TDeps, TOn, TMeta, NextDeps>(state, {
        dependencies: nextDependencies as unknown as NextDeps,
      });

      return makeHookOverrideBuilder<NextDeps, TOn, TMeta>(base, next);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = cloneHookState(state, {
        tags: mergeArray(state.tags, t, override) as TagType[],
      });
      return makeHookOverrideBuilder(base, next);
    },

    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = cloneHookState<TDeps, TOn, TMeta, TDeps, TOn, TNewMeta>(
        state as HookOverrideState<TDeps, TOn, TMeta>,
        {
          meta: m,
        },
      );
      return makeHookOverrideBuilder<TDeps, TOn, TNewMeta>(base, next);
    },

    run(fn) {
      const next = cloneHookState(state, { run: fn });
      return makeHookOverrideBuilder(base, next);
    },

    throws(list: ThrowsList) {
      const next = cloneHookState(state, { throws: list });
      return makeHookOverrideBuilder(base, next);
    },

    build() {
      const normalizedThrows = normalizeThrows(
        { kind: "hook", id: state.id },
        state.throws,
      );
      const { id: _id, on: _on, ...patch } = state;
      return defineOverride<IHook<TDeps, TOn, TMeta>>(base, {
        ...patch,
        throws: normalizedThrows,
      });
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
    throws: base.throws,
  });

  return makeHookOverrideBuilder(base, initial);
}
