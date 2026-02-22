import {
  IResource,
  ITaskMiddleware,
  IResourceMiddleware,
  ITask,
  IResourceWithConfig,
  RegisterableItems,
  IHook,
} from "../defs";
import * as utils from "../define";
import { overrideTargetNotRegisteredError } from "../errors";
import { StoreRegistry } from "./StoreRegistry";

type OverrideTargetType =
  | "Task"
  | "Resource"
  | "Task middleware"
  | "Resource middleware"
  | "Hook";

export class OverrideManager {
  public overrides: Map<
    string,
    | IResource
    | ITaskMiddleware
    | IResourceMiddleware
    | ITask
    | IResourceWithConfig
    | IHook
  > = new Map();

  public overrideRequests: Set<{
    source: string;
    override: RegisterableItems;
  }> = new Set();

  constructor(private readonly registry: StoreRegistry) {}

  private getOverrideId(
    override:
      | IResource
      | ITaskMiddleware
      | IResourceMiddleware
      | ITask
      | IResourceWithConfig
      | IHook,
  ): string {
    if (utils.isResourceWithConfig(override)) {
      return override.resource.id;
    }
    return override.id;
  }

  private getOverrideType(
    override:
      | IResource
      | ITaskMiddleware
      | IResourceMiddleware
      | ITask
      | IResourceWithConfig
      | IHook,
  ): OverrideTargetType {
    if (utils.isTask(override)) return "Task";
    if (utils.isResource(override)) return "Resource";
    if (utils.isTaskMiddleware(override)) return "Task middleware";
    if (utils.isResourceMiddleware(override)) return "Resource middleware";
    if (utils.isHook(override)) return "Hook";
    return "Resource";
  }

  private getOverrideSourcesById(targetId: string): string[] {
    const sources = new Set<string>();
    for (const request of this.overrideRequests.values()) {
      const id = utils.isResourceWithConfig(request.override)
        ? request.override.resource.id
        : request.override.id;

      if (id === targetId) {
        sources.add(request.source);
      }
    }

    return Array.from(sources.values());
  }

  storeOverridesDeeply<C>(
    element: IResource<C, any, any>,
    visited: Set<string> = new Set(),
  ) {
    if (visited.has(element.id)) {
      return;
    }

    visited.add(element.id);

    element.overrides.forEach((override) => {
      if (!override) {
        return;
      }

      if (utils.isResource(override)) {
        this.storeOverridesDeeply(override, visited);
      }

      let id: string;
      if (utils.isResourceWithConfig(override)) {
        this.storeOverridesDeeply(override.resource, visited);
        id = override.resource.id;
      } else {
        id = override.id;
      }

      this.overrideRequests.add({ source: element.id, override });
      this.overrides.set(id, override);
    });
  }

  processOverrides() {
    // If we are trying to use override on something that wasn't previously registered, we throw an error.
    for (const override of this.overrides.values()) {
      let hasAnyItem: boolean;
      if (utils.isTask(override)) {
        hasAnyItem = this.registry.tasks.has(override.id);
      } else if (utils.isResource(override)) {
        hasAnyItem = this.registry.resources.has(override.id);
      } else if (utils.isTaskMiddleware(override)) {
        hasAnyItem = this.registry.taskMiddlewares.has(override.id);
      } else if (utils.isResourceMiddleware(override)) {
        hasAnyItem = this.registry.resourceMiddlewares.has(override.id);
      } else if (utils.isResourceWithConfig(override)) {
        hasAnyItem = this.registry.resources.has(override.resource.id);
      } else {
        hasAnyItem = this.registry.hooks.has(override.id);
      }

      if (!hasAnyItem) {
        const targetId = this.getOverrideId(override);
        overrideTargetNotRegisteredError.throw({
          targetId,
          targetType: this.getOverrideType(override),
          sources: this.getOverrideSourcesById(targetId),
        });
      }
    }

    for (const override of this.overrides.values()) {
      if (utils.isTask(override)) {
        this.registry.storeTask(override, "override");
      } else if (utils.isResource(override)) {
        this.registry.storeResource(override, "override");
      } else if (utils.isTaskMiddleware(override)) {
        this.registry.storeTaskMiddleware(override, "override");
      } else if (utils.isResourceMiddleware(override)) {
        this.registry.storeResourceMiddleware(override, "override");
      } else if (utils.isResourceWithConfig(override)) {
        this.registry.storeResourceWithConfig(override, "override");
      } else {
        this.registry.storeHook(override, "override");
      }
    }
  }
}
