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
import { normalizeThrows } from "../tools/throws";

/**
 * Define a hook (event listeners).
 * Same shape as task with mandatory `on` and without `middleware`.
 */
export function defineHook<
  D extends DependencyMapType = any,
  TOn extends "*" | IEventDefinition<any> | readonly IEventDefinition<any>[] =
    any,
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
    throws: normalizeThrows({ kind: "hook", id: hookDef.id }, hookDef.throws),
  } as IHook<D, TOn, TMeta>;
}
