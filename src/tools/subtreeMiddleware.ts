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

type ConditionalSubtreeMiddlewareEntry<
  TMiddleware extends MiddlewareWithId,
  TTargetDefinition,
> = {
  use: TMiddleware;
  when?: (definition: TTargetDefinition) => boolean;
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

function isConditionalTaskSubtreeMiddlewareEntry(
  entry: SubtreeTaskMiddlewareEntry,
): entry is ConditionalSubtreeMiddlewareEntry<
  ITaskMiddleware<any, any, any, any>,
  ITask<any, any, any, any, any, any>
> {
  return (
    entry !== null &&
    typeof entry === "object" &&
    "use" in entry &&
    (entry as { use?: unknown }).use !== undefined
  );
}

function isTaskMiddlewareAttachmentEntry(
  entry: SubtreeTaskMiddlewareEntry,
): entry is ITaskMiddleware<any, any, any, any> {
  return (
    entry !== null &&
    typeof entry === "object" &&
    "id" in entry &&
    typeof (entry as { id?: unknown }).id === "string"
  );
}

function isConditionalResourceSubtreeMiddlewareEntry(
  entry: SubtreeResourceMiddlewareEntry,
): entry is ConditionalSubtreeMiddlewareEntry<
  IResourceMiddleware<any, any, any, any>,
  IResource<any, any, any, any, any, any, any>
> {
  return (
    entry !== null &&
    typeof entry === "object" &&
    "use" in entry &&
    (entry as { use?: unknown }).use !== undefined
  );
}

function isResourceMiddlewareAttachmentEntry(
  entry: SubtreeResourceMiddlewareEntry,
): entry is IResourceMiddleware<any, any, any, any> {
  return (
    entry !== null &&
    typeof entry === "object" &&
    "id" in entry &&
    typeof (entry as { id?: unknown }).id === "string"
  );
}

export function getSubtreeTaskMiddlewareAttachment(
  entry: SubtreeTaskMiddlewareEntry,
): ITaskMiddleware<any, any, any, any> {
  if (isTaskMiddlewareAttachmentEntry(entry)) {
    return entry;
  }
  if (!isConditionalTaskSubtreeMiddlewareEntry(entry)) {
    validationError.throw({
      subject: "Subtree middleware",
      id: "<unknown>",
      originalError: "Invalid subtree task middleware entry.",
    });
  }
  const conditionalEntry = entry as ConditionalSubtreeMiddlewareEntry<
    ITaskMiddleware<any, any, any, any>,
    ITask<any, any, any, any, any, any>
  >;
  return conditionalEntry.use;
}

export function getSubtreeResourceMiddlewareAttachment(
  entry: SubtreeResourceMiddlewareEntry,
): IResourceMiddleware<any, any, any, any> {
  if (isResourceMiddlewareAttachmentEntry(entry)) {
    return entry;
  }
  if (!isConditionalResourceSubtreeMiddlewareEntry(entry)) {
    validationError.throw({
      subject: "Subtree middleware",
      id: "<unknown>",
      originalError: "Invalid subtree resource middleware entry.",
    });
  }
  const conditionalEntry = entry as ConditionalSubtreeMiddlewareEntry<
    IResourceMiddleware<any, any, any, any>,
    IResource<any, any, any, any, any, any, any>
  >;
  return conditionalEntry.use;
}

function resolveTaskSubtreeMiddlewareEntry(
  entry: SubtreeTaskMiddlewareEntry,
  task: ITask<any, any, any, any, any, any>,
): ITaskMiddleware<any, any, any, any> | undefined {
  if (isTaskMiddlewareAttachmentEntry(entry)) {
    return entry;
  }

  if (!isConditionalTaskSubtreeMiddlewareEntry(entry)) {
    return;
  }

  if (!entry.when) {
    return entry.use;
  }
  return entry.when(task) ? entry.use : undefined;
}

function resolveResourceSubtreeMiddlewareEntry(
  entry: SubtreeResourceMiddlewareEntry,
  resource: IResource<any, any, any, any, any, any, any>,
): IResourceMiddleware<any, any, any, any> | undefined {
  if (isResourceMiddlewareAttachmentEntry(entry)) {
    return entry;
  }

  if (!isConditionalResourceSubtreeMiddlewareEntry(entry)) {
    return;
  }

  if (!entry.when) {
    return entry.use;
  }
  return entry.when(resource) ? entry.use : undefined;
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
