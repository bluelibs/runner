import {
  DependencyMapType,
  DependencyValuesType,
  ExtractEventPayload,
} from "./utilities";
import { IEvent, IEventDefinition, IEventEmission } from "./event";
import { HookTagType } from "./tag";
import { ITaskMeta } from "./meta";
import type { NormalizedThrowsList, ThrowsList } from "./error";
import { CommonPayload, symbolFilePath, symbolHook } from "./utilities";
import type { IsolationSubtreeFilter } from "./resource";

/** Async rollback closure returned by transactional hooks. */
export type HookRevertFn = () => Promise<void>;

/** Predicate used by hook selectors to match registered event definitions. */
export type HookOnPredicate = (event: IEvent<any>) => boolean;

/** Selector-like non-exact hook targets. */
export type HookSelectorTarget = IsolationSubtreeFilter | HookOnPredicate;

/** Individual entries allowed inside mixed hook target arrays. */
export type HookArrayOnTarget = IEventDefinition<any> | HookSelectorTarget;

/**
 * All supported hook subscription targets.
 *
 * Exact event refs keep strong payload inference, while selector-style targets
 * (`subtreeOf(...)`, predicates, or arrays containing them) intentionally widen
 * the hook event payload because the final event set is resolved at bootstrap.
 */
export type OnType =
  | "*"
  | IEventDefinition<any>
  | readonly IEventDefinition<any>[]
  | HookSelectorTarget
  | readonly HookArrayOnTarget[];

type HasSelectorEntry<TOn> = TOn extends readonly unknown[]
  ? Exclude<TOn[number], IEventDefinition<any>> extends never
    ? false
    : true
  : TOn extends "*" | IEventDefinition<any>
    ? false
    : true;

type IsTransactionalFlag<TValue> = [TValue] extends [never]
  ? false
  : [TValue] extends [true]
    ? true
    : false;

type IsTransactionalEventDefinition<TEvent> = TEvent extends {
  transactional?: infer TTransactional;
}
  ? IsTransactionalFlag<NonNullable<TTransactional>>
  : false;

type IsTransactionalOn<TOn> =
  HasSelectorEntry<TOn> extends true
    ? false
    : TOn extends "*"
      ? false
      : TOn extends readonly IEventDefinition<any>[]
        ? true extends IsTransactionalEventDefinition<TOn[number]>
          ? true
          : false
        : TOn extends IEventDefinition<any>
          ? IsTransactionalEventDefinition<TOn>
          : false;

type HookRunResult<TOn> =
  IsTransactionalOn<TOn> extends true ? HookRevertFn : any;

export interface IHookDefinition<
  TDependencies extends DependencyMapType = {},
  TOn extends OnType = any,
  TMeta extends ITaskMeta = any,
> {
  id: string;
  dependencies?: TDependencies | (() => TDependencies);
  /**
   * Event subscription target for the hook.
   *
   * Use exact event refs or `onAnyOf(...)` to preserve payload autocomplete.
   * Selector-based targets such as `subtreeOf(...)` and predicates trade
   * autocomplete for broader bootstrap-time matching.
   */
  on: TOn;
  /** Listener execution order. Lower numbers run first. */
  order?: number;
  meta?: TMeta;
  /**
   * Declares which typed errors are part of this hook's contract.
   * Declarative only — does not imply DI or enforcement.
   */
  throws?: ThrowsList;
  run: (
    event: IEventEmission<
      HasSelectorEntry<TOn> extends true
        ? any
        : TOn extends "*"
          ? any
          : TOn extends readonly IEventDefinition<any>[]
            ? CommonPayload<TOn>
            : ExtractEventPayload<TOn>
    >,
    dependencies: DependencyValuesType<TDependencies>,
  ) => Promise<HookRunResult<TOn>>;
  tags?: HookTagType[];
}

export interface IHook<
  TDependencies extends DependencyMapType = {},
  TOn extends OnType = any,
  TMeta extends ITaskMeta = any,
> extends Omit<IHookDefinition<TDependencies, TOn, TMeta>, "throws"> {
  id: string;
  path?: string;
  dependencies: TDependencies | (() => TDependencies);
  [symbolFilePath]: string;
  [symbolHook]: true;
  /** Normalized list of error ids declared via `throws`. */
  throws?: NormalizedThrowsList;
  tags: HookTagType[];
}
