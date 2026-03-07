import type {
  DependencyMapType,
  EnsureTagsForTarget,
  IEventDefinition,
  IHook,
  IHookDefinition,
  ITaskMeta,
  HookTagType,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

/** Valid event targets for hook's .on() method */
export type ValidOnTarget =
  | "*"
  | IEventDefinition<any>
  | readonly IEventDefinition<any>[];

/** Resolved TOn when valid, or `any` when undefined (build will throw at runtime) */
export type ResolvedOn<TOn> = TOn extends ValidOnTarget ? TOn : any;

/**
 * Fluent hook builder before `.on()` has been configured.
 */
export interface HookFluentBuilderWithoutOn<
  TDeps extends DependencyMapType = {},
  TMeta extends ITaskMeta = ITaskMeta,
> {
  id: string;
  on<TNewOn extends ValidOnTarget>(
    on: TNewOn,
  ): HookFluentBuilderWithOn<TDeps, TNewOn, TMeta>;
  order(order: number): HookFluentBuilderWithoutOn<TDeps, TMeta>;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: false },
  ): HookFluentBuilderWithoutOn<TDeps & TNewDeps, TMeta>;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options: { override: true },
  ): HookFluentBuilderWithoutOn<TNewDeps, TMeta>;
  tags<TNewTags extends HookTagType[]>(
    t: EnsureTagsForTarget<"hooks", TNewTags>,
    options?: { override?: boolean },
  ): HookFluentBuilderWithoutOn<TDeps, TMeta>;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): HookFluentBuilderWithoutOn<TDeps, TNewMeta>;
  /** Declare which typed errors this hook may throw (declarative only). */
  throws(list: ThrowsList): HookFluentBuilderWithoutOn<TDeps, TMeta>;
}

/**
 * Fluent hook builder after `.on()` and before `.run()`.
 */
export interface HookFluentBuilderWithOn<
  TDeps extends DependencyMapType = {},
  TOn extends ValidOnTarget = ValidOnTarget,
  TMeta extends ITaskMeta = ITaskMeta,
> {
  id: string;
  on<TNewOn extends ValidOnTarget>(
    on: TNewOn,
  ): HookFluentBuilderWithOn<TDeps, TNewOn, TMeta>;
  order(order: number): HookFluentBuilderWithOn<TDeps, TOn, TMeta>;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: false },
  ): HookFluentBuilderWithOn<TDeps & TNewDeps, TOn, TMeta>;
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options: { override: true },
  ): HookFluentBuilderWithOn<TNewDeps, TOn, TMeta>;
  tags<TNewTags extends HookTagType[]>(
    t: EnsureTagsForTarget<"hooks", TNewTags>,
    options?: { override?: boolean },
  ): HookFluentBuilderWithOn<TDeps, TOn, TMeta>;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): HookFluentBuilderWithOn<TDeps, TOn, TNewMeta>;
  /** Declare which typed errors this hook may throw (declarative only). */
  throws(list: ThrowsList): HookFluentBuilderWithOn<TDeps, TOn, TMeta>;
  /** Set the hook's run handler. Required before build(). */
  run(
    fn: IHookDefinition<TDeps, ResolvedOn<TOn>, TMeta>["run"],
  ): HookFluentBuilderAfterRun<TDeps, TOn, TMeta>;
}

/**
 * Fluent hook builder after `.run()`.
 * Shape/wiring-affecting methods are intentionally unavailable.
 */
export interface HookFluentBuilderAfterRun<
  TDeps extends DependencyMapType = {},
  TOn extends ValidOnTarget = ValidOnTarget,
  TMeta extends ITaskMeta = ITaskMeta,
> {
  id: string;
  order(order: number): HookFluentBuilderAfterRun<TDeps, TOn, TMeta>;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): HookFluentBuilderAfterRun<TDeps, TOn, TNewMeta>;
  /** Declare which typed errors this hook may throw (declarative only). */
  throws(list: ThrowsList): HookFluentBuilderAfterRun<TDeps, TOn, TMeta>;
  /**
   * Build the hook definition. Requires .on() and .run() to be called first.
   * @throws {Error} if on or run are not set
   */
  build(): IHook<TDeps, ResolvedOn<TOn>, TMeta>;
}

export type HookFluentBuilder<
  TDeps extends DependencyMapType = {},
  TOn extends ValidOnTarget | undefined = undefined,
  TMeta extends ITaskMeta = ITaskMeta,
  THasRun extends boolean = false,
> = THasRun extends true
  ? TOn extends ValidOnTarget
    ? HookFluentBuilderAfterRun<TDeps, TOn, TMeta>
    : never
  : TOn extends ValidOnTarget
    ? HookFluentBuilderWithOn<TDeps, TOn, TMeta>
    : HookFluentBuilderWithoutOn<TDeps, TMeta>;
