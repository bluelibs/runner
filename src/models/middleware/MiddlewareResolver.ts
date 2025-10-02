import {
  ITask,
  IResource,
  ITaskMiddleware,
  IResourceMiddleware,
} from "../../defs";
import { Store } from "../Store";
import { globalTags } from "../../globals/globalTags";

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
    const localIds = new Set(local.map((m) => m.id));

    const global = this.getEverywhereTaskMiddlewares(task).filter(
      (m) => !localIds.has(m.id),
    );

    return [...global, ...local];
  }

  /**
   * Gets all applicable middlewares for a resource (global + local, deduplicated)
   */
  getApplicableResourceMiddlewares(
    resource: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    const local = resource.middleware;
    const localIds = new Set(local.map((m) => m.id));

    const global = this.getEverywhereResourceMiddlewares(resource).filter(
      (m) => !localIds.has(m.id),
    );

    return [...global, ...local];
  }

  /**
   * Applies tunnel policy filter to middlewares if task is tunneled
   * Only allows whitelisted middlewares when tunnel policy is set
   */
  applyTunnelPolicyFilter(
    task: ITask<any, any, any>,
    middlewares: ITaskMiddleware[],
  ): ITaskMiddleware[] {
    const tDef = this.store.tasks.get(task.id)!.task;
    const isLocallyTunneled = tDef.isTunneled;

    if (!isLocallyTunneled || !globalTags.tunnelPolicy.exists(tDef)) {
      return middlewares;
    }

    const cfg = globalTags.tunnelPolicy.extract(task) as any;
    const allowList = cfg?.client;

    if (!Array.isArray(allowList)) {
      return middlewares;
    }

    const toId = (x: any) => (typeof x === "string" ? x : x?.id);
    const allowed = new Set(allowList.map(toId).filter(Boolean));

    return middlewares.filter((m) => allowed.has(m.id));
  }

  /**
   * Gets all "everywhere" middlewares that apply to the given task
   */
  private getEverywhereTaskMiddlewares(
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
  private getEverywhereResourceMiddlewares(
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
