import {
  IResource,
  IMiddleware,
  ITask,
  IResourceWithConfig,
  RegisterableItems,
} from "../defs";
import * as utils from "../define";
import { Errors } from "../errors";
import {
  TaskStoreElementType,
  MiddlewareStoreElementType,
  ResourceStoreElementType,
} from "./StoreTypes";
import { StoreRegistry } from "./StoreRegistry";

export class OverrideManager {
  public overrides: Map<
    string,
    IResource | IMiddleware | ITask | IResourceWithConfig
  > = new Map();

  public overrideRequests: Set<{
    source: string;
    override: RegisterableItems;
  }> = new Set();

  constructor(private readonly registry: StoreRegistry) {}

  storeOverridesDeeply<C>(element: IResource<C, any, any>) {
    element.overrides.forEach((override) => {
      if (utils.isResource(override)) {
        this.storeOverridesDeeply(override);
      }

      let id: string;
      if (utils.isResourceWithConfig(override)) {
        this.storeOverridesDeeply(override.resource);
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
      } else if (utils.isMiddleware(override)) {
        hasAnyItem = this.registry.middlewares.has(override.id);
      } else if (utils.isResourceWithConfig(override)) {
        hasAnyItem = this.registry.resources.has(override.resource.id);
      }

      if (!hasAnyItem) {
        const id = utils.isResourceWithConfig(override)
          ? override.resource.id
          : override.id;

        throw Errors.dependencyNotFound(id);
      }
    }

    for (const override of this.overrides.values()) {
      if (utils.isTask(override)) {
        this.registry.storeTask(override, false);
      } else if (utils.isResource(override)) {
        this.registry.storeResource(override, false);
      } else if (utils.isMiddleware(override)) {
        this.registry.storeMiddleware(override, false);
      } else if (utils.isResourceWithConfig(override)) {
        this.registry.storeResourceWithConfig(override, false);
      }
    }
  }
}
