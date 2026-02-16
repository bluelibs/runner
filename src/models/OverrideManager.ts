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
import { dependencyNotFoundError } from "../errors";
import { StoreRegistry } from "./StoreRegistry";

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
      let hasAnyItem = false;
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
      } else if (utils.isHook(override)) {
        hasAnyItem = this.registry.hooks.has(override.id);
      }

      if (!hasAnyItem) {
        const id = utils.isResourceWithConfig(override)
          ? override.resource.id
          : override.id;

        dependencyNotFoundError.throw({ key: id });
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
      } else if (utils.isHook(override)) {
        this.registry.storeHook(override, "override");
      }
    }
  }
}
