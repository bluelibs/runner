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
import {
  resolveApplicableSubtreeResourceMiddlewares,
  resolveApplicableSubtreeTaskMiddlewares,
} from "../../tools/subtreeMiddleware";

/**
 * Resolves which middlewares should be applied to tasks and resources.
 * Handles auto-applied middlewares, local middlewares, and tunnel policies.
 */
export class MiddlewareResolver {
  constructor(private readonly store: Store) {}

  private getOwnerResourceId(itemId: string): string | undefined {
    if (typeof this.store.getOwnerResourceId === "function") {
      return this.store.getOwnerResourceId(itemId);
    }

    const visibilityTracker = (
      this.store as unknown as {
        visibilityTracker?: {
          getOwnerResourceId?: (targetId: string) => string | undefined;
        };
      }
    ).visibilityTracker;

    if (typeof visibilityTracker?.getOwnerResourceId === "function") {
      return visibilityTracker.getOwnerResourceId(itemId);
    }

    return undefined;
  }

  private getResource(
    resourceId: string,
  ): IResource<any, any, any, any> | undefined {
    const resourcesMap = (
      this.store as unknown as {
        resources?: Map<string, { resource?: IResource<any, any, any, any> }>;
      }
    ).resources;

    if (!resourcesMap || typeof resourcesMap.get !== "function") {
      return undefined;
    }

    return resourcesMap.get(resourceId)?.resource;
  }

  /**
   * Gets all applicable middlewares for a task (global + local, deduplicated)
   */
  getApplicableTaskMiddlewares(task: ITask<any, any, any>): ITaskMiddleware[] {
    const local = task.middleware;
    const globalMiddlewares = this.getEverywhereTaskMiddlewares(task);
    const localIds = new Set(local.map((m) => m.id));

    const globalFiltered = globalMiddlewares.filter((m) => !localIds.has(m.id));

    // Global middlewares run FIRST, then local ones.
    // This allows cross-cutting policies (like logging, tracing) to wrap
    // business-specific local middleware.
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
    if (!globalTags.tunnelTaskPolicy.exists(tDef)) {
      return [];
    }

    // Use the Store definition to avoid relying on object-identity.
    // Consumers can pass a different task object with the same id.
    const cfg = globalTags.tunnelTaskPolicy.extract(tDef) as
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
   * Gets all auto-applied middlewares that apply to the given task.
   * Kept under the legacy method name for backward compatibility.
   */
  public getEverywhereTaskMiddlewares(
    task: ITask<any, any, any>,
  ): ITaskMiddleware[] {
    return resolveApplicableSubtreeTaskMiddlewares(
      {
        getOwnerResourceId: (itemId) => this.getOwnerResourceId(itemId),
        getResource: (resourceId) => this.getResource(resourceId),
      },
      task,
    );
  }

  /**
   * Gets all auto-applied middlewares that apply to the given resource.
   * Kept under the legacy method name for backward compatibility.
   */
  public getEverywhereResourceMiddlewares(
    resource: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    return resolveApplicableSubtreeResourceMiddlewares(
      {
        getOwnerResourceId: (itemId) => this.getOwnerResourceId(itemId),
        getResource: (resourceId) => this.getResource(resourceId),
      },
      resource,
    );
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
