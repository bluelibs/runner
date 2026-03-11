import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
} from "../../tools/subtreeMiddleware";
import { getStoredSubtreePolicy } from "../../definers/subtreePolicy";
import type { StoreRegistry } from "../StoreRegistry";
import type {
  DependencyValidationEntry,
  MiddlewareVisibilityEntry,
  TagValidationEntry,
} from "./contracts";
import {
  resolveReferenceIds,
  resolveSubtreeMiddlewareReferenceIds,
} from "./visibilityValidationReferences";

export function collectDependencyEntries(
  registry: StoreRegistry,
): DependencyValidationEntry[] {
  return [
    ...Array.from(registry.tasks.values(), ({ task }) => ({
      consumerId: task.id,
      consumerType: "Task",
      dependencies: task.dependencies,
    })),
    ...Array.from(registry.resources.values(), ({ resource }) => ({
      consumerId: resource.id,
      consumerType: "Resource",
      dependencies: resource.dependencies,
    })),
    ...Array.from(registry.hooks.values(), ({ hook }) => ({
      consumerId: hook.id,
      consumerType: "Hook",
      dependencies: hook.dependencies,
    })),
    ...Array.from(registry.taskMiddlewares.values(), ({ middleware }) => ({
      consumerId: middleware.id,
      consumerType: "Task middleware",
      dependencies: middleware.dependencies,
    })),
    ...Array.from(registry.resourceMiddlewares.values(), ({ middleware }) => ({
      consumerId: middleware.id,
      consumerType: "Resource middleware",
      dependencies: middleware.dependencies,
    })),
  ];
}

export function collectTagEntries(
  registry: StoreRegistry,
): TagValidationEntry[] {
  return [
    ...Array.from(registry.tasks.values(), ({ task }) => ({
      consumerId: task.id,
      consumerType: "Task",
      tags: task.tags,
    })),
    ...Array.from(registry.resources.values(), ({ resource }) => ({
      consumerId: resource.id,
      consumerType: "Resource",
      tags: resource.tags,
    })),
    ...Array.from(registry.events.values(), ({ event }) => ({
      consumerId: event.id,
      consumerType: "Event",
      tags: event.tags,
    })),
    ...Array.from(registry.hooks.values(), ({ hook }) => ({
      consumerId: hook.id,
      consumerType: "Hook",
      tags: hook.tags,
    })),
    ...Array.from(registry.taskMiddlewares.values(), ({ middleware }) => ({
      consumerId: middleware.id,
      consumerType: "Task middleware",
      tags: middleware.tags,
    })),
    ...Array.from(registry.resourceMiddlewares.values(), ({ middleware }) => ({
      consumerId: middleware.id,
      consumerType: "Resource middleware",
      tags: middleware.tags,
    })),
  ];
}

export function collectMiddlewareVisibilityEntries(
  registry: StoreRegistry,
): MiddlewareVisibilityEntry[] {
  return [
    ...Array.from(registry.tasks.values(), ({ task }) => ({
      consumerId: task.id,
      consumerType: "Task",
      targetType: "Task middleware",
      targetIds: resolveReferenceIds(registry, task.middleware),
    })),
    ...Array.from(registry.resources.values(), ({ resource }) => ({
      consumerId: resource.id,
      consumerType: "Resource",
      targetType: "Resource middleware",
      targetIds: resolveReferenceIds(registry, resource.middleware),
    })),
    ...Array.from(registry.resources.values(), ({ resource }) => ({
      consumerId: resource.id,
      consumerType: "Resource",
      targetType: "Task middleware",
      targetIds: resolveSubtreeMiddlewareReferenceIds(
        registry,
        getStoredSubtreePolicy(resource)?.tasks?.middleware ?? [],
        getSubtreeTaskMiddlewareAttachment,
      ),
    })),
    ...Array.from(registry.resources.values(), ({ resource }) => ({
      consumerId: resource.id,
      consumerType: "Resource",
      targetType: "Resource middleware",
      targetIds: resolveSubtreeMiddlewareReferenceIds(
        registry,
        getStoredSubtreePolicy(resource)?.resources?.middleware ?? [],
        getSubtreeResourceMiddlewareAttachment,
      ),
    })),
  ];
}
