import type {
  IResource,
  IResourceMiddleware,
  ITask,
  ITaskMiddleware,
  SubtreeResourceMiddlewareEntry,
  SubtreeTaskMiddlewareEntry,
} from "../defs";
import { validationError } from "../errors";

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

type MiddlewareTargetKind = "task" | "resource";

type ConditionalSubtreeMiddlewareEntry<
  TMiddleware extends MiddlewareWithId,
  TTargetDefinition,
> = {
  use: TMiddleware;
  when?: (definition: TTargetDefinition) => boolean;
};

function throwInvalidSubtreeMiddlewareEntry(kind: MiddlewareTargetKind): never {
  return validationError.throw({
    subject: "Subtree middleware",
    id: "<unknown>",
    originalError: `Invalid subtree ${kind} middleware entry.`,
  }) as never;
}

function isMiddlewareAttachment<TAttachment extends MiddlewareWithId>(
  entry: unknown,
): entry is TAttachment {
  return (
    entry !== null &&
    typeof entry === "object" &&
    "id" in entry &&
    typeof (entry as { id?: unknown }).id === "string"
  );
}

function isConditionalSubtreeMiddlewareEntry<
  TMiddleware extends MiddlewareWithId,
  TTargetDefinition,
>(
  entry: unknown,
): entry is ConditionalSubtreeMiddlewareEntry<TMiddleware, TTargetDefinition> {
  return (
    entry !== null &&
    typeof entry === "object" &&
    "use" in entry &&
    isMiddlewareAttachment<TMiddleware>((entry as { use?: unknown }).use)
  );
}

function extractSubtreeMiddlewareAttachment<
  TMiddleware extends MiddlewareWithId,
  TTargetDefinition,
>(
  entry:
    | TMiddleware
    | ConditionalSubtreeMiddlewareEntry<TMiddleware, TTargetDefinition>,
  kind: MiddlewareTargetKind,
): TMiddleware {
  if (isMiddlewareAttachment<TMiddleware>(entry)) {
    return entry;
  }
  if (
    isConditionalSubtreeMiddlewareEntry<TMiddleware, TTargetDefinition>(entry)
  ) {
    return entry.use;
  }
  return throwInvalidSubtreeMiddlewareEntry(kind);
}

function resolveSubtreeMiddlewareEntry<
  TMiddleware extends MiddlewareWithId,
  TTargetDefinition,
>(
  entry:
    | TMiddleware
    | ConditionalSubtreeMiddlewareEntry<TMiddleware, TTargetDefinition>,
  targetDefinition: TTargetDefinition,
  kind: MiddlewareTargetKind,
): TMiddleware | undefined {
  if (isMiddlewareAttachment<TMiddleware>(entry)) {
    return entry;
  }

  if (
    !isConditionalSubtreeMiddlewareEntry<TMiddleware, TTargetDefinition>(entry)
  ) {
    return throwInvalidSubtreeMiddlewareEntry(kind);
  }

  if (!entry.when) {
    return entry.use;
  }
  return entry.when(targetDefinition) ? entry.use : undefined;
}

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

export function getSubtreeTaskMiddlewareAttachment(
  entry: SubtreeTaskMiddlewareEntry,
): ITaskMiddleware<any, any, any, any> {
  return extractSubtreeMiddlewareAttachment<
    ITaskMiddleware<any, any, any, any>,
    ITask<any, any, any, any, any, any>
  >(entry, "task");
}

export function getSubtreeResourceMiddlewareAttachment(
  entry: SubtreeResourceMiddlewareEntry,
): IResourceMiddleware<any, any, any, any> {
  return extractSubtreeMiddlewareAttachment<
    IResourceMiddleware<any, any, any, any>,
    IResource<any, any, any, any, any, any, any>
  >(entry, "resource");
}

function resolveTaskSubtreeMiddlewareEntry(
  entry: SubtreeTaskMiddlewareEntry,
  task: ITask<any, any, any, any, any, any>,
): ITaskMiddleware<any, any, any, any> | undefined {
  return resolveSubtreeMiddlewareEntry<
    ITaskMiddleware<any, any, any, any>,
    ITask<any, any, any, any, any, any>
  >(entry, task, "task");
}

function resolveResourceSubtreeMiddlewareEntry(
  entry: SubtreeResourceMiddlewareEntry,
  resource: IResource<any, any, any, any, any, any, any>,
): IResourceMiddleware<any, any, any, any> | undefined {
  return resolveSubtreeMiddlewareEntry<
    IResourceMiddleware<any, any, any, any>,
    IResource<any, any, any, any, any, any, any>
  >(entry, resource, "resource");
}

function resolveApplicableSubtreeMiddlewares<
  TMiddleware extends MiddlewareWithId,
  TTargetDefinition,
  TSubtreeMiddlewareEntry,
>(
  lookup: SubtreeLookup,
  chainNearestToRoot: readonly string[],
  targetDefinition: TTargetDefinition,
  readSubtreeMiddlewares: (
    resource: IResource<any, any, any, any, any, any, any>,
  ) => readonly TSubtreeMiddlewareEntry[] | undefined,
  resolveEntry: (
    entry: TSubtreeMiddlewareEntry,
    targetDefinition: TTargetDefinition,
  ) => TMiddleware | undefined,
): TMiddleware[] {
  const chainRootToNearest = [...chainNearestToRoot].reverse();
  const byMiddlewareId = new Map<
    string,
    {
      middleware: TMiddleware;
      order: number;
      ownerResourceId: string;
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

    for (const middlewareEntry of middlewares) {
      const middleware = resolveEntry(middlewareEntry, targetDefinition);
      if (!middleware) {
        continue;
      }

      const existing = byMiddlewareId.get(middleware.id);
      if (existing) {
        validationError.throw({
          subject: "Subtree middleware",
          id: middleware.id,
          originalError: `Duplicate middleware id "${middleware.id}" resolved from resources "${existing.ownerResourceId}" and "${ownerResourceId}".`,
        });
      }

      byMiddlewareId.set(middleware.id, {
        middleware,
        order,
        ownerResourceId,
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
    task,
    (resource) => resource.subtree?.tasks?.middleware,
    resolveTaskSubtreeMiddlewareEntry,
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
    resource,
    (ownerResource) => ownerResource.subtree?.resources?.middleware,
    resolveResourceSubtreeMiddlewareEntry,
  );
}
