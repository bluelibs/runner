import {
  DependencyMapType,
  DependencyValuesType,
  ExtractEventPayload,
} from "./utilities";
import { IEventDefinition, IEventEmission } from "./event";
import { TagType } from "./tag";
import { ITaskMeta } from "./meta";
import type { ThrowsList } from "./error";
import { CommonPayload, symbolFilePath, symbolHook } from "./utilities";

export type OnType =
  | "*"
  | IEventDefinition<any>
  | readonly IEventDefinition<any>[];

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
  ) => Promise<any>;
  tags?: TagType[];
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
  tags: TagType[];
}
