import {
  IResource,
  ITask,
  SubtreeResourceMiddlewareEntry,
  SubtreeTaskMiddlewareEntry,
  symbolResourceSubtreeDeclarations,
} from "../../../defs";
import type { RunnerMode } from "../../../types/runner";
import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
} from "../../../tools/subtreeMiddleware";
import { resolveResourceSubtreeDeclarations } from "../../../definers/subtreePolicy";
import { CanonicalIdCompiler } from "./CanonicalIdCompiler";
import { createOwnerScope, type OwnerScope } from "./OwnerScope";
import { RegisterableKind } from "./registerableKind";
import { StoreRegistryDefinitionCloner } from "./StoreRegistryDefinitionCloner";
import type {
  StoreRegistryAliasResolver,
  StoreRegistryCollections,
} from "./StoreRegistryWriter.types";

export class StoreRegistryReferenceNormalizer {
  constructor(
    private readonly canonicalIdCompiler: CanonicalIdCompiler,
    private readonly collections: StoreRegistryCollections,
    private readonly aliasResolver: StoreRegistryAliasResolver,
    private readonly definitionCloner: StoreRegistryDefinitionCloner,
  ) {}

  normalizeTaskMiddlewareAttachments(
    task: ITask<any, any, {}>,
  ): ITask<any, any, {}>["middleware"] {
    const ownerResourceId = this.resolveOwnerResourceIdFromTaskId(task.id);
    return this.normalizeMiddlewareAttachments(
      ownerResourceId ? createOwnerScope(ownerResourceId) : null,
      RegisterableKind.TaskMiddleware,
      task.middleware,
    );
  }

  normalizeResourceMiddlewareAttachments(
    resource: IResource<any, any, any>,
  ): IResource<any, any, any>["middleware"] {
    return this.normalizeMiddlewareAttachments(
      createOwnerScope(resource.id),
      RegisterableKind.ResourceMiddleware,
      resource.middleware,
    );
  }

  normalizeResourceSubtreeMiddlewareAttachments(
    resource: IResource<any, any, any>,
    config: unknown,
    runtimeMode: RunnerMode,
  ): IResource<any, any, any>["subtree"] {
    const subtree = resolveResourceSubtreeDeclarations(
      resource[symbolResourceSubtreeDeclarations],
      config,
      runtimeMode,
    );
    if (!subtree) {
      return subtree;
    }

    const ownerScope = createOwnerScope(resource.id);
    let hasChanges = false;
    let normalizedTaskPolicy = subtree.tasks;
    let normalizedResourcePolicy = subtree.resources;

    if (subtree.tasks?.middleware?.length) {
      const middleware = subtree.tasks.middleware.map((entry) =>
        this.normalizeSubtreeTaskMiddlewareEntry(ownerScope, entry),
      );
      if (this.didArrayChange(subtree.tasks.middleware, middleware)) {
        normalizedTaskPolicy = {
          ...subtree.tasks,
          middleware,
        };
        hasChanges = true;
      }
    }

    if (subtree.resources?.middleware?.length) {
      const middleware = subtree.resources.middleware.map((entry) =>
        this.normalizeSubtreeResourceMiddlewareEntry(ownerScope, entry),
      );
      if (this.didArrayChange(subtree.resources.middleware, middleware)) {
        normalizedResourcePolicy = {
          ...subtree.resources,
          middleware,
        };
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return subtree;
    }

    return {
      ...subtree,
      ...(normalizedTaskPolicy ? { tasks: normalizedTaskPolicy } : {}),
      ...(normalizedResourcePolicy
        ? { resources: normalizedResourcePolicy }
        : {}),
    };
  }

  normalizeSubtreeTaskMiddlewareEntry(
    ownerScopeOrResourceId: OwnerScope | string,
    entryOrUsesFrameworkRootIds: SubtreeTaskMiddlewareEntry | boolean,
    maybeEntry?: SubtreeTaskMiddlewareEntry,
  ): SubtreeTaskMiddlewareEntry {
    const ownerScope = this.normalizeOwnerScopeArg(
      ownerScopeOrResourceId,
      entryOrUsesFrameworkRootIds,
    );
    const entry =
      maybeEntry ?? (entryOrUsesFrameworkRootIds as SubtreeTaskMiddlewareEntry);

    return this.normalizeSubtreeMiddlewareEntry(
      ownerScope,
      RegisterableKind.TaskMiddleware,
      entry,
      getSubtreeTaskMiddlewareAttachment,
    );
  }

  normalizeSubtreeResourceMiddlewareEntry(
    ownerScopeOrResourceId: OwnerScope | string,
    entryOrUsesFrameworkRootIds: SubtreeResourceMiddlewareEntry | boolean,
    maybeEntry?: SubtreeResourceMiddlewareEntry,
  ): SubtreeResourceMiddlewareEntry {
    const ownerScope = this.normalizeOwnerScopeArg(
      ownerScopeOrResourceId,
      entryOrUsesFrameworkRootIds,
    );
    const entry =
      maybeEntry ??
      (entryOrUsesFrameworkRootIds as SubtreeResourceMiddlewareEntry);

    return this.normalizeSubtreeMiddlewareEntry(
      ownerScope,
      RegisterableKind.ResourceMiddleware,
      entry,
      getSubtreeResourceMiddlewareAttachment,
    );
  }

  resolveOwnerResourceIdFromTaskId(taskId: string): string | null {
    const separator = ".tasks.";
    const separatorIndex = taskId.lastIndexOf(separator);
    if (separatorIndex < 0) {
      return null;
    }

    return taskId.slice(0, separatorIndex);
  }

  didArrayChange<T>(source: ReadonlyArray<T>, next: ReadonlyArray<T>): boolean {
    if (source.length !== next.length) {
      return true;
    }

    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== next[index]) {
        return true;
      }
    }

    return false;
  }

  private normalizeMiddlewareAttachments<TAttachment extends { id: string }>(
    ownerScope: OwnerScope | null,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    attachments: TAttachment[],
  ): TAttachment[] {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return attachments;
    }

    if (!ownerScope) {
      return attachments;
    }

    return attachments.map((attachment) =>
      this.registerMiddlewareAttachmentAlias(ownerScope, kind, attachment),
    );
  }

  private normalizeSubtreeMiddlewareEntry<
    TAttachment extends { id: string },
    TEntry extends TAttachment | ({ use: TAttachment } & object),
  >(
    ownerScope: OwnerScope,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    entry: TEntry,
    getAttachment: (entry: TEntry) => TAttachment,
  ): TEntry {
    const attachment = getAttachment(entry);
    const normalizedAttachment = this.normalizeMiddlewareAttachment(
      ownerScope,
      kind,
      attachment,
    );

    if (normalizedAttachment === attachment) {
      return entry;
    }

    if ("use" in entry) {
      return {
        ...(entry as object),
        use: normalizedAttachment,
      } as TEntry;
    }

    return normalizedAttachment as TEntry;
  }

  private normalizeMiddlewareAttachment<TAttachment extends { id: string }>(
    ownerScope: OwnerScope,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    attachment: TAttachment,
  ): TAttachment {
    const resolvedId = this.resolveMiddlewareAttachmentId(
      ownerScope,
      kind,
      attachment,
    );

    if (resolvedId === attachment.id) {
      return attachment;
    }

    const normalized = this.definitionCloner.cloneWithId(
      attachment as TAttachment & { id: string },
      resolvedId,
    );
    this.aliasResolver.registerDefinitionAlias(attachment, resolvedId);
    this.aliasResolver.registerDefinitionAlias(normalized, resolvedId);
    return normalized;
  }

  private registerMiddlewareAttachmentAlias<TAttachment extends { id: string }>(
    ownerScope: OwnerScope,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    attachment: TAttachment,
  ): TAttachment {
    const resolvedId = this.resolveMiddlewareAttachmentId(
      ownerScope,
      kind,
      attachment,
    );
    if (resolvedId !== attachment.id) {
      this.aliasResolver.registerDefinitionAlias(attachment, resolvedId);
    }

    return attachment;
  }

  private resolveMiddlewareAttachmentId<TAttachment extends { id: string }>(
    ownerScope: OwnerScope,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    attachment: TAttachment,
  ): string {
    const resolvedByAliasCandidate =
      this.aliasResolver.resolveDefinitionId(attachment);
    const resolvedByAlias =
      typeof resolvedByAliasCandidate === "string" &&
      this.isRegisteredMiddlewareId(kind, resolvedByAliasCandidate)
        ? resolvedByAliasCandidate
        : undefined;

    return (
      resolvedByAlias ??
      this.canonicalIdCompiler.compute(ownerScope, kind, attachment.id)
    );
  }

  private isRegisteredMiddlewareId(
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    candidateId: string,
  ): boolean {
    return kind === RegisterableKind.TaskMiddleware
      ? this.collections.taskMiddlewares.has(candidateId)
      : this.collections.resourceMiddlewares.has(candidateId);
  }

  private normalizeOwnerScopeArg<TEntry>(
    ownerScopeOrResourceId: OwnerScope | string,
    entryOrUsesFrameworkRootIds: TEntry | boolean,
  ): OwnerScope {
    if (typeof ownerScopeOrResourceId !== "string") {
      return ownerScopeOrResourceId;
    }

    return {
      resourceId: ownerScopeOrResourceId,
      usesFrameworkRootIds:
        typeof entryOrUsesFrameworkRootIds === "boolean"
          ? entryOrUsesFrameworkRootIds
          : false,
    };
  }
}
