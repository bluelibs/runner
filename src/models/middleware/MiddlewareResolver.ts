import {
  ITask,
  IResource,
  ITaskMiddleware,
  IResourceMiddleware,
  symbolRpcLanePolicy,
  type IRpcLanePolicy,
  type RpcLaneMiddlewareId,
} from "../../defs";
import { Store } from "../store/Store";
import {
  subtreeMiddlewareConflictError,
  taskNotRegisteredError,
  validationError,
} from "../../errors";
import {
  getSubtreeMiddlewareDuplicateKey,
  resolveNearestSubtreeMiddlewareIdentityScope,
  resolveApplicableSubtreeResourceMiddlewares,
  resolveApplicableSubtreeTaskMiddlewareEntries,
} from "../../tools/subtreeMiddleware";
import {
  extractRequestedId,
  resolveCanonicalIdFromStore,
} from "../store/StoreLookup";
import { globalTags } from "../../globals/globalTags";
import {
  identityScopesMatch,
  type IdentityScopeConfig,
} from "../../globals/middleware/identityScope.shared";
import { identityCheckerTaskMiddleware } from "../../globals/middleware/identityChecker.middleware";
import { mergeMiddlewareConfig } from "../../definers/middlewareConfig";

/**
 * Resolves which middlewares should be applied to tasks and resources.
 * Handles auto-applied middlewares, local middlewares, and rpc-lane policies.
 */
export class MiddlewareResolver {
  private readonly taskMiddlewareCache = new Map<string, ITaskMiddleware[]>();
  private readonly taskMiddlewareEntryCache = new Map<
    string,
    ReturnType<typeof resolveApplicableSubtreeTaskMiddlewareEntries>
  >();
  private readonly resourceMiddlewareCache = new Map<
    string,
    IResourceMiddleware[]
  >();
  private readonly rpcLaneAllowSetCache = new Map<
    string,
    ReadonlySet<string> | null
  >();

  constructor(private readonly store: Store) {}

  private resolveDefinitionId(reference: unknown): string {
    return (
      resolveCanonicalIdFromStore(this.store, reference) ??
      extractRequestedId(reference) ??
      String(reference)
    );
  }

  private resolveRegisteredMiddlewareId(
    reference: unknown,
    taskId: string,
  ): string {
    const resolvedId =
      resolveCanonicalIdFromStore(this.store, reference) ??
      extractRequestedId(reference);
    if (resolvedId) {
      return resolvedId;
    }

    validationError.throw({
      subject: "rpcLane middlewareAllowList",
      id: taskId,
      originalError: `Middleware "${extractRequestedId(reference) ?? String(reference)}" is not registered.`,
    });

    return undefined as never;
  }

  /**
   * Gets all applicable middlewares for a task.
   * Fails fast when subtree and local middleware resolve to the same id.
   */
  getApplicableTaskMiddlewares(task: ITask<any, any, any>): ITaskMiddleware[] {
    const taskId = this.resolveDefinitionId(task);
    const effectiveTask = this.store.tasks.get(taskId)?.task ?? task;
    if (this.store.isLocked) {
      const cached = this.taskMiddlewareCache.get(taskId);
      if (cached) {
        return cached;
      }
    }

    const local = effectiveTask.middleware;
    const globalMiddlewares = this.getEverywhereTaskMiddlewares(effectiveTask);
    const globalMiddlewareEntries =
      this.getEverywhereTaskMiddlewareEntries(effectiveTask);
    const localIds = new Set(
      local.map((middleware) =>
        getSubtreeMiddlewareDuplicateKey(middleware.id),
      ),
    );
    const conflictingGlobalIndex = globalMiddlewares.findIndex(
      (middleware, index) => {
        const duplicateKey =
          globalMiddlewareEntries[index]?.duplicateKey ??
          getSubtreeMiddlewareDuplicateKey(middleware.id);
        return localIds.has(duplicateKey);
      },
    );
    const conflictingGlobal =
      conflictingGlobalIndex >= 0
        ? globalMiddlewares[conflictingGlobalIndex]
        : undefined;

    if (conflictingGlobal) {
      subtreeMiddlewareConflictError.throw({
        middlewareId: getSubtreeMiddlewareDuplicateKey(conflictingGlobal.id),
        targetKind: "task",
      });
    }

    const globalFiltered = globalMiddlewares.filter((middleware, index) => {
      const duplicateKey =
        globalMiddlewareEntries[index]?.duplicateKey ??
        getSubtreeMiddlewareDuplicateKey(middleware.id);
      return !localIds.has(duplicateKey);
    });

    // Global middlewares run FIRST, then local ones.
    // This allows cross-cutting policies (like logging, tracing) to wrap
    // business-specific local middleware.
    const result = [
      ...globalFiltered,
      ...this.applyTaskIdentityScopePolicyToMiddlewares(effectiveTask, local),
    ];

    if (this.store.isLocked) {
      this.taskMiddlewareCache.set(taskId, result);
    }

    return result;
  }

  /**
   * Gets all applicable middlewares for a resource.
   * Fails fast when subtree and local middleware resolve to the same id.
   */
  getApplicableResourceMiddlewares(
    resource: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    const resourceId = this.resolveDefinitionId(resource);
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
    const localIds = new Set(
      local.map((middleware) =>
        getSubtreeMiddlewareDuplicateKey(middleware.id),
      ),
    );
    const conflictingGlobal = globalMiddlewares.find((middleware) =>
      localIds.has(getSubtreeMiddlewareDuplicateKey(middleware.id)),
    );

    if (conflictingGlobal) {
      subtreeMiddlewareConflictError.throw({
        middlewareId: getSubtreeMiddlewareDuplicateKey(conflictingGlobal.id),
        targetKind: "resource",
      });
    }

    const globalFiltered = globalMiddlewares.filter(
      (middleware) =>
        !localIds.has(getSubtreeMiddlewareDuplicateKey(middleware.id)),
    );

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
    const taskId = this.resolveDefinitionId(task);
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
      return middlewares.filter((middleware) =>
        this.shouldRetainRpcMiddlewareByDefault(middleware),
      );
    }

    return middlewares.filter(
      (middleware) =>
        allowSet.has(middleware.id) ||
        this.shouldRetainRpcMiddlewareByDefault(middleware),
    );
  }

  private shouldRetainRpcMiddlewareByDefault(
    middleware: ITaskMiddleware,
  ): boolean {
    // Identity gates are authorization boundaries, not optional caller-side
    // behavior. Routed tasks must still enforce them even when RPC mode skips
    // the rest of the local middleware stack by default.
    return middleware.id === identityCheckerTaskMiddleware.id;
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
    const allowSet = Array.isArray(allowList)
      ? new Set(
          allowList.map((entry) =>
            this.resolveRegisteredMiddlewareId(entry, taskId),
          ),
        )
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
    return this.getEverywhereTaskMiddlewareEntries(task).map(
      (entry) => entry.middleware,
    );
  }

  private getEverywhereTaskMiddlewareEntries(task: ITask<any, any, any>) {
    const taskId = this.resolveDefinitionId(task);
    const effectiveTask = this.store.tasks.get(taskId)?.task ?? task;
    if (this.store.isLocked) {
      const cached = this.taskMiddlewareEntryCache.get(taskId);
      if (cached) {
        return cached;
      }
    }

    const resolved = this.applyTaskIdentityScopePolicy(
      effectiveTask,
      this.resolveEverywhereTaskMiddlewareEntries(effectiveTask),
    );

    if (this.store.isLocked) {
      this.taskMiddlewareEntryCache.set(taskId, resolved);
    }

    return resolved;
  }

  private resolveEverywhereTaskMiddlewareEntries(task: ITask<any, any, any>) {
    return resolveApplicableSubtreeTaskMiddlewareEntries(
      {
        getOwnerResourceId: (itemId) => this.store.getOwnerResourceId(itemId),
        getResource: (resourceId) =>
          this.store.resources.get(resourceId)?.resource,
      },
      task,
    );
  }

  private applyTaskIdentityScopePolicy(
    task: ITask<any, any, any>,
    middlewares: ReturnType<
      typeof resolveApplicableSubtreeTaskMiddlewareEntries
    >,
  ): ReturnType<typeof resolveApplicableSubtreeTaskMiddlewareEntries> {
    const subtreeIdentityScope = resolveNearestSubtreeMiddlewareIdentityScope(
      {
        getOwnerResourceId: (itemId) => this.store.getOwnerResourceId(itemId),
        getResource: (resourceId) =>
          this.store.resources.get(resourceId)?.resource,
      },
      task,
    );

    if (!subtreeIdentityScope) {
      return middlewares;
    }

    return middlewares.map((entry) => {
      const scopedMiddleware = this.enforceTaskMiddlewareIdentityScope(
        task.id,
        entry.middleware,
        subtreeIdentityScope,
      );

      if (scopedMiddleware === entry.middleware) {
        return entry;
      }

      return {
        ...entry,
        middleware: scopedMiddleware,
      };
    });
  }

  private applyTaskIdentityScopePolicyToMiddlewares(
    task: ITask<any, any, any>,
    middlewares: ITaskMiddleware[],
  ): ITaskMiddleware[] {
    const subtreeIdentityScope = resolveNearestSubtreeMiddlewareIdentityScope(
      {
        getOwnerResourceId: (itemId: string) =>
          this.store.getOwnerResourceId(itemId),
        getResource: (resourceId: string) =>
          this.store.resources.get(resourceId)?.resource,
      },
      task,
    );

    if (!subtreeIdentityScope) {
      return middlewares;
    }

    return middlewares.map((middleware) =>
      this.enforceTaskMiddlewareIdentityScope(
        task.id,
        middleware,
        subtreeIdentityScope,
      ),
    );
  }

  private enforceTaskMiddlewareIdentityScope(
    taskId: string,
    middleware: ITaskMiddleware,
    identityScope: IdentityScopeConfig,
  ): ITaskMiddleware {
    if (!globalTags.identityScoped.exists(middleware)) {
      return middleware;
    }

    const existingIdentityScope = (
      middleware.config as {
        identityScope?: IdentityScopeConfig;
      }
    ).identityScope;

    if (existingIdentityScope === undefined) {
      const mergedConfig = mergeMiddlewareConfig(middleware.config, {
        identityScope,
      });
      return middleware.with(mergedConfig as never);
    }

    if (!identityScopesMatch(existingIdentityScope, identityScope)) {
      validationError.throw({
        subject: "Subtree middleware.identityScope",
        id: taskId,
        originalError: `Task middleware "${middleware.id}" already declares identityScope ${JSON.stringify(
          existingIdentityScope,
        )}, but subtree middleware.identityScope requires ${JSON.stringify(
          identityScope,
        )}. These values must match exactly or the middleware must omit identityScope.`,
      });
    }

    return middleware;
  }

  /**
   * Gets all auto-applied middlewares that apply to the given resource.
   */
  public getEverywhereResourceMiddlewares(
    resource: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    const resourceId = this.resolveDefinitionId(resource);
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
