import type {
  DependencyMapType,
  IEventDefinition,
  IHook,
  IHookDefinition,
  ITaskMeta,
  TagType,
} from "../../defs";
import { defineHook } from "../defineHook";

type BuilderState<
  TDeps extends DependencyMapType,
  TOn extends "*" | IEventDefinition<any> | readonly IEventDefinition<any>[],
  TMeta extends ITaskMeta,
> = Readonly<
  Required<
    Pick<
      IHookDefinition<TDeps, TOn, TMeta>,
      "id" | "dependencies" | "on" | "order" | "meta" | "run" | "tags"
    >
  >
>;

function clone<
  TDeps extends DependencyMapType,
  TOn extends "*" | IEventDefinition<any> | readonly IEventDefinition<any>[],
  TMeta extends ITaskMeta,
>(
  s: BuilderState<TDeps, TOn, TMeta>,
  patch: Partial<BuilderState<TDeps, TOn, TMeta>>,
) {
  return Object.freeze({ ...s, ...patch }) as BuilderState<TDeps, TOn, TMeta>;
}

export interface HookFluentBuilder<
  TDeps extends DependencyMapType = {},
  TOn extends
    | "*"
    | IEventDefinition<any>
    | readonly IEventDefinition<any>[] = any,
  TMeta extends ITaskMeta = ITaskMeta,
> {
  id: string;
  on<
    TNewOn extends
      | "*"
      | IEventDefinition<any>
      | readonly IEventDefinition<any>[],
  >(
    on: TNewOn,
  ): HookFluentBuilder<TDeps, TNewOn, TMeta>;
  order(order: number): HookFluentBuilder<TDeps, TOn, TMeta>;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
  ): HookFluentBuilder<TNewDeps, TOn, TMeta>;
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
  ): HookFluentBuilder<TDeps, TOn, TMeta>;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): HookFluentBuilder<TDeps, TOn, TNewMeta>;
  run(
    fn: IHookDefinition<TDeps, TOn, TMeta>["run"],
  ): HookFluentBuilder<TDeps, TOn, TMeta>;
  build(): IHook<TDeps, TOn, TMeta>;
}

function makeHookBuilder<
  TDeps extends DependencyMapType,
  TOn extends "*" | IEventDefinition<any> | readonly IEventDefinition<any>[],
  TMeta extends ITaskMeta,
>(
  state: BuilderState<TDeps, TOn, TMeta>,
): HookFluentBuilder<TDeps, TOn, TMeta> {
  const b: HookFluentBuilder<any, any, any> = {
    id: state.id,
    on<
      TNewOn extends
        | "*"
        | IEventDefinition<any>
        | readonly IEventDefinition<any>[],
    >(on: TNewOn) {
      const next = clone(state, { on: on as any });
      return makeHookBuilder<TDeps, TNewOn, TMeta>(
        next as unknown as BuilderState<TDeps, TNewOn, TMeta>,
      );
    },
    order(order: number) {
      const next = clone(state, { order });
      return makeHookBuilder<TDeps, TOn, TMeta>(next);
    },
    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | (() => TNewDeps),
    ) {
      const next = clone(state, { dependencies: deps as any });
      return makeHookBuilder<TNewDeps, TOn, TMeta>(
        next as unknown as BuilderState<TNewDeps, TOn, TMeta>,
      );
    },
    tags<TNewTags extends TagType[]>(t: TNewTags) {
      const next = clone(state, { tags: t as any });
      return makeHookBuilder<TDeps, TOn, TMeta>(next);
    },
    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m as any });
      return makeHookBuilder<TDeps, TOn, TNewMeta>(
        next as unknown as BuilderState<TDeps, TOn, TNewMeta>,
      );
    },
    run(fn) {
      const next = clone(state, { run: fn as any });
      return makeHookBuilder<TDeps, TOn, TMeta>(next);
    },
    build() {
      return defineHook({
        ...(state as unknown as IHookDefinition<TDeps, TOn, TMeta>),
      });
    },
  };
  return b as HookFluentBuilder<TDeps, TOn, TMeta>;
}

export function hookBuilder(id: string): HookFluentBuilder<{}, any, ITaskMeta> {
  const initial: BuilderState<{}, any, ITaskMeta> = Object.freeze({
    id,
    dependencies: {} as any,
    on: "*" as any,
    order: undefined as any,
    meta: {} as any,
    run: undefined as any,
    tags: [] as any,
  });
  return makeHookBuilder(initial);
}

export const hook = hookBuilder;
