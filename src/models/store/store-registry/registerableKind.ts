import {
  RegisterableItem,
  symbolEvent,
  symbolHook,
  symbolResource,
  symbolResourceMiddleware,
  symbolResourceWithConfig,
  symbolTag,
  symbolTask,
  symbolTaskMiddleware,
} from "../../../defs";
import { symbolAsyncContext, symbolError } from "../../../types/symbols";

export enum RegisterableKind {
  Task = "task",
  Error = "error",
  Hook = "hook",
  Resource = "resource",
  Event = "event",
  AsyncContext = "asyncContext",
  TaskMiddleware = "taskMiddleware",
  ResourceMiddleware = "resourceMiddleware",
  ResourceWithConfig = "resourceWithConfig",
  Tag = "tag",
}

function hasSymbolBrand(
  item: RegisterableItem,
  symbolKey: symbol,
): item is RegisterableItem {
  if (item === null || item === undefined) {
    return false;
  }

  const type = typeof item;
  if (type !== "object" && type !== "function") {
    return false;
  }

  return Boolean((item as unknown as Record<symbol, unknown>)[symbolKey]);
}

/**
 * Shared registerable classification used by both registration and validation
 * paths so new definition kinds cannot drift between those code paths.
 */
export function resolveRegisterableKind(
  item: RegisterableItem,
): RegisterableKind | null {
  if (hasSymbolBrand(item, symbolTask)) {
    return RegisterableKind.Task;
  }
  if (hasSymbolBrand(item, symbolError)) {
    return RegisterableKind.Error;
  }
  if (hasSymbolBrand(item, symbolHook)) {
    return RegisterableKind.Hook;
  }
  if (hasSymbolBrand(item, symbolResource)) {
    return RegisterableKind.Resource;
  }
  if (hasSymbolBrand(item, symbolEvent)) {
    return RegisterableKind.Event;
  }
  if (hasSymbolBrand(item, symbolAsyncContext)) {
    return RegisterableKind.AsyncContext;
  }
  if (hasSymbolBrand(item, symbolTaskMiddleware)) {
    return RegisterableKind.TaskMiddleware;
  }
  if (hasSymbolBrand(item, symbolResourceMiddleware)) {
    return RegisterableKind.ResourceMiddleware;
  }
  if (hasSymbolBrand(item, symbolResourceWithConfig)) {
    return RegisterableKind.ResourceWithConfig;
  }
  if (hasSymbolBrand(item, symbolTag)) {
    return RegisterableKind.Tag;
  }

  return null;
}

export function describeRegisterableKind(
  kind: RegisterableKind | null,
): string {
  switch (kind) {
    case RegisterableKind.Task:
      return "Task";
    case RegisterableKind.Error:
      return "Error";
    case RegisterableKind.Hook:
      return "Hook";
    case RegisterableKind.Resource:
      return "Resource";
    case RegisterableKind.Event:
      return "Event";
    case RegisterableKind.AsyncContext:
      return "Async context";
    case RegisterableKind.TaskMiddleware:
      return "Task middleware";
    case RegisterableKind.ResourceMiddleware:
      return "Resource middleware";
    case RegisterableKind.ResourceWithConfig:
      return "Resource";
    case RegisterableKind.Tag:
      return "Tag";
    default:
      return "Unknown registration";
  }
}
