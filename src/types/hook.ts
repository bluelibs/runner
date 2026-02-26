import {
  DependencyMapType,
  DependencyValuesType,
  ExtractEventPayload,
} from "./utilities";
import { IEventDefinition, IEventEmission } from "./event";
import { HookTagType } from "./tag";
import { ITaskMeta } from "./meta";
import type { ThrowsList } from "./error";
import { CommonPayload, symbolFilePath, symbolHook } from "./utilities";

export type HookRevertFn = () => Promise<void>;

export type OnType =
  | "*"
  | IEventDefinition<any>
  | readonly IEventDefinition<any>[];

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

type IsTransactionalOn<TOn> = TOn extends "*"
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
      TOn extends "*"
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
> extends IHookDefinition<TDependencies, TOn, TMeta> {
  id: string;
  dependencies: TDependencies | (() => TDependencies);
  [symbolFilePath]: string;
  [symbolHook]: true;
  /** Normalized list of error ids declared via `throws`. */
  throws?: readonly string[];
  tags: HookTagType[];
}
