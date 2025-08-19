import {
  DependencyMapType,
  IEventDefinition,
  ITaskMeta,
  IHook,
  IHookDefinition,
  symbolHook,
  symbolFilePath,
} from "../defs";
import { getCallerFile } from "../tools/getCallerFile";

/**
 * Define a hook (event listeners).
 * Same shape as task with mandatory `on` and without `middleware`.
 */
export function defineHook<
  D extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition = any,
  TMeta extends ITaskMeta = any,
>(hookDef: IHookDefinition<D, TOn, TMeta>): IHook<D, TOn, TMeta> {
  const filePath = getCallerFile();
  return {
    [symbolHook]: true,
    [symbolFilePath]: filePath,
    id: hookDef.id,
    dependencies: hookDef.dependencies || ({} as D),
    on: hookDef.on,
    order: hookDef.order,
    run: hookDef.run,
    meta: hookDef.meta || ({} as TMeta),
    tags: hookDef.tags || [],
  } as IHook<D, TOn, TMeta>;
}