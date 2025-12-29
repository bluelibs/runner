import type {
  DependencyMapType,
  IEventDefinition,
  IHook,
  IHookDefinition,
  ITaskMeta,
  TagType,
} from "../../../defs";

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
  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: false },
  ): HookFluentBuilder<TDeps & TNewDeps, TOn, TMeta>;
  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options: { override: true },
  ): HookFluentBuilder<TNewDeps, TOn, TMeta>;
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options?: { override?: boolean },
  ): HookFluentBuilder<TDeps, TOn, TMeta>;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): HookFluentBuilder<TDeps, TOn, TNewMeta>;
  run(
    fn: IHookDefinition<TDeps, TOn, TMeta>["run"],
  ): HookFluentBuilder<TDeps, TOn, TMeta>;
  build(): IHook<TDeps, TOn, TMeta>;
}
