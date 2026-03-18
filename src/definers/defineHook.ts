import {
  DependencyMapType,
  ITaskMeta,
  IHook,
  IHookDefinition,
  OnType,
  symbolHook,
  symbolFilePath,
} from "../defs";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze } from "../tools/deepFreeze";
import { normalizeThrows } from "../tools/throws";
import { assertTagTargetsApplicableTo } from "./assertTagTargetsApplicable";
import { assertDefinitionId } from "./assertDefinitionId";

/**
 * Define a hook (event listeners).
 * Same shape as task with mandatory `on` and without `middleware`.
 */
export function defineHook<
  D extends DependencyMapType = any,
  TOn extends OnType = any,
  TMeta extends ITaskMeta = any,
>(hookDef: IHookDefinition<D, TOn, TMeta>): IHook<D, TOn, TMeta> {
  const filePath = getCallerFile();
  assertDefinitionId("Hook", hookDef.id);
  assertTagTargetsApplicableTo("hooks", "Hook", hookDef.id, hookDef.tags);
  return deepFreeze({
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
  } as IHook<D, TOn, TMeta>);
}
