import {
  DependencyMapType,
  DependencyValuesType,
  IEventDefinition,
  IEventEmission,
  ExtractEventParams,
} from "../defs";
import { TagType } from "./tag";
import { ITaskMeta } from "./meta";
import { symbolFilePath, symbolHook } from "./utilities";

export interface IHookDefinition<
  TDependencies extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> = any,
  TMeta extends ITaskMeta = any,
> {
  id: string;
  dependencies?: TDependencies | (() => TDependencies);
  on: TOn;
  /** Listener execution order. Lower numbers run first. */
  order?: number;
  meta?: TMeta;
  run: (
    event: IEventEmission<TOn extends "*" ? any : ExtractEventParams<TOn>>,
    dependencies: DependencyValuesType<TDependencies>,
  ) => Promise<any>;
  tags?: TagType[];
}

export interface IHook<
  TDependencies extends DependencyMapType = {},
  TOn extends "*" | IEventDefinition<any> = any,
  TMeta extends ITaskMeta = any,
> extends IHookDefinition<TDependencies, TOn, TMeta> {
  id: string;
  dependencies: TDependencies | (() => TDependencies);
  [symbolFilePath]: string;
  [symbolHook]: true;
  tags: TagType[];
}
