import {
  IResource,
  IMiddleware,
  ITask,
  IResourceWithConfig,
  RegisterableItems,
} from "../defs";
import * as utils from "../define";
import { Errors } from "../errors";
import { TaskStoreElementType, MiddlewareStoreElementType, ResourceStoreElementType } from "./StoreTypes";

export class OverrideManager {
  public overrides: Map<
    string,
    IResource | IMiddleware | ITask | IResourceWithConfig
  > = new Map();
  
  public overrideRequests: Set<{
    source: string;
    override: RegisterableItems;
  }> = new Set();

  constructor(
    private tasks: Map<string, TaskStoreElementType>,
    private resources: Map<string, ResourceStoreElementType>,
    private middlewares: Map<string, MiddlewareStoreElementType>,
    private storeTask: (item: ITask<any, any, {}>, check?: boolean) => void,
    private storeResource: (item: IResource<any, any, any>, check?: boolean) => void,
    private storeMiddleware: (item: IMiddleware<any>, check?: boolean) => void,
    private storeResourceWithConfig: (item: IResourceWithConfig<any, any, any>, check?: boolean) => void
  ) {}

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
        hasAnyItem = this.tasks.has(override.id);
      } else if (utils.isResource(override)) {
        hasAnyItem = this.resources.has(override.id);
      } else if (utils.isMiddleware(override)) {
        hasAnyItem = this.middlewares.has(override.id);
      } else if (utils.isResourceWithConfig(override)) {
        hasAnyItem = this.resources.has(override.resource.id);
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
        this.storeTask(override, false);
      } else if (utils.isResource(override)) {
        this.storeResource(override, false);
      } else if (utils.isMiddleware(override)) {
        this.storeMiddleware(override, false);
      } else if (utils.isResourceWithConfig(override)) {
        this.storeResourceWithConfig(override, false);
      }
    }
  }
}