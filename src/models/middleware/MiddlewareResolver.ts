import {
  ITask,
  IResource,
  ITaskMiddleware,
  IResourceMiddleware,
} from "../../defs";
import { Store } from "../Store";
import { globalTags } from "../../globals/globalTags";
import { taskNotRegisteredError } from "../../errors";
import type {
  TunnelMiddlewareId,
  TunnelTaskMiddlewarePolicyConfig,
} from "../../globals/resources/tunnel/tunnel.policy.tag";

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
   * For tunneled tasks, controls caller-side task middleware execution.
   * Caller-side middleware is skipped by default and can be re-enabled via allowlist.
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

    if (!isLocallyTunneled) {
      return middlewares;
    }

    // Tunneled tasks skip caller-side middleware by default.
    // Only explicitly allowlisted middleware runs locally.
    if (!globalTags.tunnelPolicy.exists(tDef)) {
      return [];
    }

    // Use the Store definition to avoid relying on object-identity.
    // Consumers can pass a different task object with the same id.
    const cfg = globalTags.tunnelPolicy.extract(tDef) as
      | TunnelTaskMiddlewarePolicyConfig
      | undefined;
    const clientAllowList = getClientMiddlewareAllowList(cfg);

    if (!Array.isArray(clientAllowList)) {
      return [];
    }

    const toId = (x: string | { id: string }) =>
      typeof x === "string" ? x : x?.id;
    const allowed = new Set(
      clientAllowList.map(toId).filter((id): id is string => !!id),
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

function getClientMiddlewareAllowList(
  cfg: TunnelTaskMiddlewarePolicyConfig | undefined,
): TunnelMiddlewareId[] | undefined {
  if (!cfg) {
    return;
  }

  const preferred = cfg.client;
  if (Array.isArray(preferred)) {
    return preferred;
  }
  if (preferred && typeof preferred === "object") {
    const allowList = preferred.middlewareAllowList;
    if (Array.isArray(allowList)) return allowList;
  }

  const grouped = cfg.middlewareAllowList?.client;
  if (Array.isArray(grouped)) {
    return grouped;
  }

  return;
}
