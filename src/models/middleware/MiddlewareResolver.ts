import {
  ITask,
  IResource,
  ITaskMiddleware,
  IResourceMiddleware,
  symbolRpcLanePolicy,
  type IRpcLanePolicy,
  type RpcLaneMiddlewareId,
} from "../../defs";
import { Store } from "../Store";
import { taskNotRegisteredError } from "../../errors";
import {
  resolveApplicableSubtreeResourceMiddlewares,
  resolveApplicableSubtreeTaskMiddlewares,
} from "../../tools/subtreeMiddleware";

/**
 * Resolves which middlewares should be applied to tasks and resources.
 * Handles auto-applied middlewares, local middlewares, and rpc-lane policies.
 */
export class MiddlewareResolver {
  private readonly taskMiddlewareCache = new Map<string, ITaskMiddleware[]>();
  private readonly resourceMiddlewareCache = new Map<
    string,
    IResourceMiddleware[]
  >();
  private readonly rpcLaneAllowSetCache = new Map<
    string,
    ReadonlySet<string> | null
  >();

  constructor(private readonly store: Store) {}

  /**
   * Gets all applicable middlewares for a task (global + local, deduplicated)
   */
  getApplicableTaskMiddlewares(task: ITask<any, any, any>): ITaskMiddleware[] {
    const taskId = this.store.resolveDefinitionId(task)!;
    const effectiveTask = this.store.tasks.get(taskId)?.task ?? task;
    if (this.store.isLocked) {
      const cached = this.taskMiddlewareCache.get(taskId);
      if (cached) {
        return cached;
      }
    }

    const local = effectiveTask.middleware;
    const globalMiddlewares = this.getEverywhereTaskMiddlewares(effectiveTask);
    const localIds = new Set(local.map((middleware) => middleware.id));

    const globalFiltered = globalMiddlewares.filter((m) => !localIds.has(m.id));

    // Global middlewares run FIRST, then local ones.
    // This allows cross-cutting policies (like logging, tracing) to wrap
    // business-specific local middleware.
    const result = [...globalFiltered, ...local];

    if (this.store.isLocked) {
      this.taskMiddlewareCache.set(taskId, result);
    }

    return result;
  }

  /**
   * Gets all applicable middlewares for a resource (global + local, deduplicated)
   */
  getApplicableResourceMiddlewares(
    resource: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    const resourceId = this.store.resolveDefinitionId(resource)!;
    const effectiveResource =
      this.store.resources.get(resourceId)?.resource ?? resource;
    if (this.store.isLocked) {
      const cached = this.resourceMiddlewareCache.get(resourceId);
      if (cached) {
        return cached;
      }
    }

    const local = effectiveResource.middleware;
    const globalMiddlewares =
      this.getEverywhereResourceMiddlewares(effectiveResource);
    const localIds = new Set(local.map((middleware) => middleware.id));

    const globalFiltered = globalMiddlewares.filter((m) => !localIds.has(m.id));

    const result = [...globalFiltered, ...local];

    if (this.store.isLocked) {
      this.resourceMiddlewareCache.set(resourceId, result);
    }

    return result;
  }

  /**
   * For rpc-routed tasks, controls caller-side task middleware execution.
   * Caller-side middleware is skipped by default and can be re-enabled via allowlist.
   */
  applyRpcLanePolicyFilter(
    task: ITask<any, any, any>,
    middlewares: ITaskMiddleware[],
  ): ITaskMiddleware[] {
    const taskId = this.store.resolveDefinitionId(task)!;
    const entry = this.store.tasks.get(taskId);
    if (!entry) {
      return taskNotRegisteredError.throw({ taskId });
    }
    const tDef = entry.task;
    const isRpcRouted = tDef.isRpcRouted;

    if (!isRpcRouted) {
      return middlewares;
    }

    // RPC-routed tasks skip caller-side middleware by default.
    // Only explicitly allowlisted middleware runs locally.
    // Use the Store definition to avoid relying on object-identity.
    // Consumers can pass a different task object with the same id.
    const policy = tDef[symbolRpcLanePolicy];
    const allowSet = this.getRpcLaneAllowSet(taskId, policy);

    if (!allowSet) {
      return [];
    }

    return middlewares.filter((middleware) => allowSet.has(middleware.id));
  }

  private getRpcLaneAllowSet(
    taskId: string,
    policy: IRpcLanePolicy | undefined,
  ): ReadonlySet<string> | null {
    if (this.store.isLocked) {
      const cached = this.rpcLaneAllowSetCache.get(taskId);
      if (cached !== undefined) {
        return cached;
      }
    }

    const allowList = getMiddlewareAllowList(policy);
    const toId = (x: string | { id: string }) =>
      this.store.resolveDefinitionId(x);
    const allowSet = Array.isArray(allowList)
      ? new Set(allowList.map(toId).filter((id): id is string => !!id))
      : null;

    if (this.store.isLocked) {
      this.rpcLaneAllowSetCache.set(taskId, allowSet);
    }

    return allowSet;
  }

  /**
   * Gets all auto-applied middlewares that apply to the given task.
   */
  public getEverywhereTaskMiddlewares(
    task: ITask<any, any, any>,
  ): ITaskMiddleware[] {
    const taskId = this.store.resolveDefinitionId(task)!;
    const effectiveTask = this.store.tasks.get(taskId)?.task ?? task;

    return resolveApplicableSubtreeTaskMiddlewares(
      {
        getOwnerResourceId: (itemId) => this.store.getOwnerResourceId(itemId),
        getResource: (resourceId) =>
          this.store.resources.get(resourceId)?.resource,
      },
      effectiveTask,
    );
  }

  /**
   * Gets all auto-applied middlewares that apply to the given resource.
   */
  public getEverywhereResourceMiddlewares(
    resource: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    const resourceId = this.store.resolveDefinitionId(resource)!;
    const effectiveResource =
      this.store.resources.get(resourceId)?.resource ?? resource;

    return resolveApplicableSubtreeResourceMiddlewares(
      {
        getOwnerResourceId: (itemId) => this.store.getOwnerResourceId(itemId),
        getResource: (resourceId) =>
          this.store.resources.get(resourceId)?.resource,
      },
      effectiveResource,
    );
  }
}

function getMiddlewareAllowList(
  policy: IRpcLanePolicy | undefined,
): RpcLaneMiddlewareId[] | undefined {
  const allowList = policy?.middlewareAllowList;
  if (!Array.isArray(allowList)) {
    return;
  }

  return allowList;
}
