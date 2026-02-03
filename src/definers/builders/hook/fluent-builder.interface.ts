import type {
  DependencyMapType,
  IEventDefinition,
  IHook,
  IHookDefinition,
  ITaskMeta,
  TagType,
} from "../../../defs";

/** Valid event targets for hook's .on() method */
type ValidOnTarget =
  | "*"
  | IEventDefinition<any>
  | readonly IEventDefinition<any>[];

/** Resolved TOn when valid, or `any` when undefined (build will throw at runtime) */
type ResolvedOn<TOn> = TOn extends ValidOnTarget ? TOn : any;

export interface HookFluentBuilder<
  TDeps extends DependencyMapType = {},
  TOn extends ValidOnTarget | undefined = undefined,
  TMeta extends ITaskMeta = ITaskMeta,
> {
  id: string;
  on<TNewOn extends ValidOnTarget>(
    on: TNewOn,
  ): HookFluentBuilder<TDeps, TNewOn, TMeta>;
  order(order: number): HookFluentBuilder<TDeps, TOn, TMeta>;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: false },
  ): HookFluentBuilder<TDeps & TNewDeps, TOn, TMeta>;
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
  /** Set the hook's run handler. Required before build(). */
  run(
    fn: IHookDefinition<TDeps, ResolvedOn<TOn>, TMeta>["run"],
  ): HookFluentBuilder<TDeps, TOn, TMeta>;
  /**
   * Build the hook definition. Requires .on() and .run() to be called first.
   * @throws {Error} if on or run are not set
   */
  build(): IHook<TDeps, ResolvedOn<TOn>, TMeta>;
}
