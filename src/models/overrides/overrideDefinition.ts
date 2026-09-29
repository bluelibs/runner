import {
  IHook,
  IResource,
  IResourceMiddleware,
  ITask,
  ITaskMiddleware,
  RegisterableItem,
  symbolOverrideTargetDefinition,
} from "../../defs";
import * as utils from "../../define";
import { unknownItemTypeError } from "../../errors";

type OverrideTargetType =
  | "Task"
  | "Resource"
  | "Task middleware"
  | "Resource middleware"
  | "Hook";

export type SupportedOverride =
  | ITask
  | IResource
  | ITaskMiddleware
  | IResourceMiddleware
  | IHook;

export function toSupportedOverride(
  override: RegisterableItem,
): SupportedOverride {
  if (
    utils.isTask(override) ||
    utils.isResource(override) ||
    utils.isTaskMiddleware(override) ||
    utils.isResourceMiddleware(override) ||
    utils.isHook(override)
  ) {
    return override;
  }

  return unknownItemTypeError.throw({ item: override });
}

export function getOverrideType(
  override: SupportedOverride,
): OverrideTargetType {
  if (utils.isTask(override)) return "Task";
  if (utils.isResource(override)) {
    return "Resource";
  }
  if (utils.isTaskMiddleware(override)) return "Task middleware";
  if (utils.isResourceMiddleware(override)) return "Resource middleware";
  return "Hook";
}

export function getOverrideTargetReference(
  override: SupportedOverride,
): SupportedOverride {
  const maybeTarget = (override as unknown as Record<symbol, unknown>)[
    symbolOverrideTargetDefinition
  ];

  return (maybeTarget ?? override) as SupportedOverride;
}
