import type {
  IResource,
  IResourceMiddleware,
  ITask,
  ITaskMiddleware,
  SubtreeResourceMiddlewareEntry,
  SubtreeTaskMiddlewareEntry,
} from "../defs";
import { isResourceMiddleware, isTaskMiddleware } from "../definers/tools";
import { getStoredSubtreePolicy } from "../definers/subtreePolicy";
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

const taskMiddlewareScopeMarker = ".middleware.task.";
const resourceMiddlewareScopeMarker = ".middleware.resource.";

export function getSubtreeMiddlewareDuplicateKey(id: string): string {
  const taskScopeIndex = id.lastIndexOf(taskMiddlewareScopeMarker);
  if (taskScopeIndex >= 0) {
    return id.slice(taskScopeIndex + taskMiddlewareScopeMarker.length);
  }

  const resourceScopeIndex = id.lastIndexOf(resourceMiddlewareScopeMarker);
  if (resourceScopeIndex >= 0) {
    return id.slice(resourceScopeIndex + resourceMiddlewareScopeMarker.length);
  }

  return id;
}

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

type MiddlewareAttachmentCandidate<TMiddleware extends MiddlewareWithId> =
  | TMiddleware
  | {
      id?: unknown;
    }
  | object
  | null
  | undefined;

type ConditionalSubtreeMiddlewareEntryCandidate<
  TMiddleware extends MiddlewareWithId,
  TTargetDefinition,
> =
  | TMiddleware
  | ConditionalSubtreeMiddlewareEntry<TMiddleware, TTargetDefinition>
  | {
      use?: MiddlewareAttachmentCandidate<TMiddleware>;
      when?: (definition: TTargetDefinition) => boolean;
    }
  | null
  | undefined;

function throwInvalidSubtreeMiddlewareEntry(kind: MiddlewareTargetKind): never {
  return validationError.throw({
    subject: "Subtree middleware",
    id: "<unknown>",
    originalError: `Invalid subtree ${kind} middleware entry.`,
  }) as never;
}

function getMiddlewareAttachment<TAttachment extends MiddlewareWithId>(
  entry: MiddlewareAttachmentCandidate<TAttachment>,
): TAttachment | undefined {
  if (!entry || typeof entry !== "object") {
    return;
  }

  if (isTaskMiddleware(entry) || isResourceMiddleware(entry)) {
    return entry as unknown as TAttachment;
  }

  if (!("id" in entry)) {
    return undefined;
  }

  return typeof entry.id === "string" ? (entry as TAttachment) : undefined;
}

function getConditionalSubtreeMiddlewareEntry<
  TMiddleware extends MiddlewareWithId,
  TTargetDefinition,
>(
  entry: ConditionalSubtreeMiddlewareEntryCandidate<
    TMiddleware,
    TTargetDefinition
  >,
):
  | ConditionalSubtreeMiddlewareEntry<TMiddleware, TTargetDefinition>
  | undefined {
  if (entry === null || typeof entry !== "object" || !("use" in entry)) {
    return undefined;
  }

  if (!getMiddlewareAttachment<TMiddleware>(entry.use)) {
    return undefined;
  }

  return entry as ConditionalSubtreeMiddlewareEntry<
    TMiddleware,
    TTargetDefinition
  >;
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
  const directAttachment = getMiddlewareAttachment<TMiddleware>(entry);
  if (directAttachment) {
    return directAttachment;
  }

  const conditionalEntry = getConditionalSubtreeMiddlewareEntry<
    TMiddleware,
    TTargetDefinition
  >(entry);
  if (conditionalEntry) {
    return conditionalEntry.use;
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
  const directAttachment = getMiddlewareAttachment<TMiddleware>(entry);
  if (directAttachment) {
    return directAttachment;
  }

  const conditionalEntry = getConditionalSubtreeMiddlewareEntry<
    TMiddleware,
    TTargetDefinition
  >(entry);
  if (!conditionalEntry) {
    return throwInvalidSubtreeMiddlewareEntry(kind);
  }

  if (!conditionalEntry.when) {
    return conditionalEntry.use;
  }

  return conditionalEntry.when(targetDefinition)
    ? conditionalEntry.use
    : undefined;
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

      const duplicateKey = getSubtreeMiddlewareDuplicateKey(middleware.id);
      const existing = byMiddlewareId.get(duplicateKey);
      if (existing) {
        validationError.throw({
          subject: "Subtree middleware",
          id: duplicateKey,
          originalError: `Duplicate middleware id "${duplicateKey}" resolved from resources "${existing.ownerResourceId}" and "${ownerResourceId}".`,
        });
      }

      byMiddlewareId.set(duplicateKey, {
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
    (resource) => getStoredSubtreePolicy(resource)?.tasks?.middleware,
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
    (ownerResource) =>
      getStoredSubtreePolicy(ownerResource)?.resources?.middleware,
    resolveResourceSubtreeMiddlewareEntry,
  );
}
