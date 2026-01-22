import {
  ITask,
  IResource,
  ITaskMiddleware,
  IResourceMiddleware,
} from "../../defs";
import { Store } from "../Store";
import { globalTags } from "../../globals/globalTags";
import { taskNotRegisteredError } from "../../errors";

/**
 * Resolves which middlewares should be applied to tasks and resources.
 * Handles global "everywhere" middlewares, local middlewares, and tunnel policies.
 */
export class MiddlewareResolver {
  constructor(private readonly store: Store) {}

  /**
   * Gets all applicable middlewares for a task (global + local, deduplicated)
   */
  getApplicableTaskMiddlewares(task: ITask<any, any, any>): ITaskMiddleware[] {
    const local = task.middleware;
    const globalMiddlewares = this.getEverywhereTaskMiddlewares(task);
    const localIds = new Set(local.map((m) => m.id));

    const globalFiltered = globalMiddlewares.filter((m) => !localIds.has(m.id));

    // Global middlewares run FIRST, then local ones.
    // This allows global "everywhere" policies (like logging, tracing) to wrap business-specific local middleware.
    return [...globalFiltered, ...local];
  }

  /**
   * Gets all applicable middlewares for a resource (global + local, deduplicated)
   */
  getApplicableResourceMiddlewares(
    resource: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    const local = resource.middleware;
    const globalMiddlewares = this.getEverywhereResourceMiddlewares(resource);
    const localIds = new Set(local.map((m) => m.id));

    const globalFiltered = globalMiddlewares.filter((m) => !localIds.has(m.id));

    return [...globalFiltered, ...local];
  }

  /**
   * Applies tunnel policy filter to middlewares if task is tunneled
   * Only allows whitelisted middlewares when tunnel policy is set
   */
  applyTunnelPolicyFilter(
    task: ITask<any, any, any>,
    middlewares: ITaskMiddleware[],
  ): ITaskMiddleware[] {
    const entry = this.store.tasks.get(task.id);
    if (!entry) {
      return taskNotRegisteredError.throw({ taskId: task.id });
    }
    const tDef = entry.task;
    const isLocallyTunneled = tDef.isTunneled;

    if (!isLocallyTunneled || !globalTags.tunnelPolicy.exists(tDef)) {
      return middlewares;
    }

    // Use the Store definition to avoid relying on object-identity.
    // Consumers can pass a different task object with the same id.
    const cfg = globalTags.tunnelPolicy.extract(tDef);
    const allowList = cfg?.client;

    if (!Array.isArray(allowList)) {
      return middlewares;
    }

    const toId = (x: string | { id: string }) =>
      typeof x === "string" ? x : x?.id;
    const allowed = new Set(
      allowList.map(toId).filter((id): id is string => !!id),
    );

    return middlewares.filter((m) => allowed.has(m.id));
  }

  /**
   * Gets all "everywhere" middlewares that apply to the given task
   */
  public getEverywhereTaskMiddlewares(
    task: ITask<any, any, any>,
  ): ITaskMiddleware[] {
    return Array.from(this.store.taskMiddlewares.values())
      .filter((x) => Boolean(x.middleware.everywhere))
      .filter((x) => {
        if (typeof x.middleware.everywhere === "function") {
          return x.middleware.everywhere(task);
        }
        return true;
      })
      .map((x) => x.middleware);
  }

  /**
   * Gets all "everywhere" middlewares that apply to the given resource
   */
  public getEverywhereResourceMiddlewares(
    resource: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    return Array.from(this.store.resourceMiddlewares.values())
      .filter((x) => Boolean(x.middleware.everywhere))
      .filter((x) => {
        if (typeof x.middleware.everywhere === "function") {
          return x.middleware.everywhere(resource);
        }
        return true;
      })
      .map((x) => x.middleware);
  }
}
