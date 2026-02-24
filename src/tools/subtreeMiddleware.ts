import type {
  IResource,
  IResourceMiddleware,
  ITask,
  ITaskMiddleware,
} from "../defs";

type SubtreeLookup = {
  getOwnerResourceId: (itemId: string) => string | undefined;
  getResource: (
    resourceId: string,
  ) => IResource<any, any, any, any, any, any, any> | undefined;
};

type MiddlewareWithId = {
  id: string;
};

type ResolveSubtreeMiddlewareOptions = {
  targetId: string;
  isResourceTarget: boolean;
};

export function getTargetOwnerResourceChain(
  lookup: SubtreeLookup,
  options: ResolveSubtreeMiddlewareOptions,
): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentOwnerId = options.isResourceTarget
    ? options.targetId
    : lookup.getOwnerResourceId(options.targetId);

  while (currentOwnerId !== undefined && !visited.has(currentOwnerId)) {
    visited.add(currentOwnerId);
    chain.push(currentOwnerId);
    currentOwnerId = lookup.getOwnerResourceId(currentOwnerId);
  }

  return chain;
}

function resolveApplicableSubtreeMiddlewares<
  TMiddleware extends MiddlewareWithId,
>(
  lookup: SubtreeLookup,
  chainNearestToRoot: readonly string[],
  readSubtreeMiddlewares: (
    resource: IResource<any, any, any, any, any, any, any>,
  ) => readonly TMiddleware[] | undefined,
): TMiddleware[] {
  const chainRootToNearest = [...chainNearestToRoot].reverse();
  const byMiddlewareId = new Map<
    string,
    {
      middleware: TMiddleware;
      order: number;
    }
  >();
  let order = 0;

  for (const ownerResourceId of chainRootToNearest) {
    const ownerResource = lookup.getResource(ownerResourceId);
    if (!ownerResource) {
      continue;
    }

    const middlewares = readSubtreeMiddlewares(ownerResource);
    if (!middlewares || middlewares.length === 0) {
      continue;
    }

    for (const middleware of middlewares) {
      byMiddlewareId.set(middleware.id, {
        middleware,
        order,
      });
      order += 1;
    }
  }

  return Array.from(byMiddlewareId.values())
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.middleware);
}

export function resolveApplicableSubtreeTaskMiddlewares(
  lookup: SubtreeLookup,
  task: ITask<any, any, any, any, any, any>,
): ITaskMiddleware[] {
  const chain = getTargetOwnerResourceChain(lookup, {
    targetId: task.id,
    isResourceTarget: false,
  });

  return resolveApplicableSubtreeMiddlewares(
    lookup,
    chain,
    (resource) => resource.subtree?.tasks?.middleware,
  );
}

export function resolveApplicableSubtreeResourceMiddlewares(
  lookup: SubtreeLookup,
  resource: IResource<any, any, any, any, any, any, any>,
): IResourceMiddleware[] {
  const chain = getTargetOwnerResourceChain(lookup, {
    targetId: resource.id,
    isResourceTarget: true,
  });

  return resolveApplicableSubtreeMiddlewares(
    lookup,
    chain,
    (ownerResource) => ownerResource.subtree?.resources?.middleware,
  );
}
