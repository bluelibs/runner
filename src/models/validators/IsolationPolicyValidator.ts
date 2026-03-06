import {
  isolateInvalidEntryError,
  isolateUnknownTargetError,
  isolateConflictError,
  isolateExportsUnknownTargetError,
  isolateInvalidExportsError,
} from "../../errors";
import type {
  IsolationExportsTarget,
  IsolationPolicy,
  IsolationSubtreeFilter,
  IsolationTarget,
  ItemType,
} from "../../defs";
import { isTag, isSubtreeFilter, isIsolationScope } from "../../define";
import type { IsolationScope, IsolationScopeTarget } from "../../tools/scope";
import { scope } from "../../tools/scope";
import {
  getSubtreeFilterResourceReference,
  isSubtreeFilterItemType,
} from "../../tools/subtreeOf";
import type { ValidatorContext } from "./ValidatorContext";

/** Input for normalization functions */
export type NormalizationInput = {
  entries: ReadonlyArray<unknown>;
  policyResourceId?: string;
  onInvalidEntry: (entry: unknown) => never;
  onUnknownTarget: (targetId: string) => never;
};

/**
 * Validates and normalizes isolation policies on resources.
 */
export function validateIsolationPolicies(ctx: ValidatorContext): void {
  for (const { resource } of ctx.registry.resources.values()) {
    const policy = resource.isolate;
    if (!policy) {
      continue;
    }

    const denyPresent = "deny" in policy && policy.deny !== undefined;
    const onlyPresent = "only" in policy && policy.only !== undefined;

    if (denyPresent && !Array.isArray(policy.deny)) {
      isolateInvalidEntryError.throw({
        policyResourceId: resource.id,
        entry: policy.deny,
      });
    }

    if (onlyPresent && !Array.isArray(policy.only)) {
      isolateInvalidEntryError.throw({
        policyResourceId: resource.id,
        entry: policy.only,
      });
    }

    const hasDeny = Array.isArray(policy.deny) && policy.deny.length > 0;
    const hasOnly = Array.isArray(policy.only) && policy.only.length > 0;

    const exportsPresent = "exports" in policy && policy.exports !== undefined;

    // Conflict is determined by field presence, not emptiness
    if (denyPresent && onlyPresent) {
      isolateConflictError.throw({
        policyResourceId: resource.id,
      });
    }

    const normalizedPolicy: IsolationPolicy = {
      ...(denyPresent ? { deny: policy.deny } : {}),
      ...(onlyPresent ? { only: policy.only } : {}),
    };

    if (
      exportsPresent &&
      policy.exports !== "none" &&
      !Array.isArray(policy.exports)
    ) {
      isolateInvalidExportsError.throw({
        policyResourceId: resource.id,
        entry: policy.exports,
      });
    }

    if (Array.isArray(policy.exports)) {
      normalizedPolicy.exports = normalizeExportEntries(ctx, {
        entries: policy.exports,
        onInvalidEntry: (entry) =>
          isolateInvalidExportsError.throw({
            policyResourceId: resource.id,
            entry,
          }),
        onUnknownTarget: (targetId) =>
          isolateExportsUnknownTargetError.throw({
            policyResourceId: resource.id,
            targetId,
          }),
      });
    } else if (policy.exports === "none") {
      normalizedPolicy.exports = "none";
    }

    const entries = hasDeny ? policy.deny! : hasOnly ? policy.only! : [];

    if (entries.length > 0) {
      const normalizedEntries = normalizeIsolationEntries<IsolationTarget>(
        ctx,
        {
          entries,
          policyResourceId: resource.id,
          onInvalidEntry: (entry) =>
            isolateInvalidEntryError.throw({
              policyResourceId: resource.id,
              entry,
            }),
          onUnknownTarget: (targetId) =>
            isolateUnknownTargetError.throw({
              policyResourceId: resource.id,
              targetId,
            }),
        },
      );

      if (hasDeny) {
        normalizedPolicy.deny = normalizedEntries;
      } else {
        normalizedPolicy.only = normalizedEntries;
      }
    }

    resource.isolate = normalizedPolicy;
    ctx.registry.visibilityTracker.recordIsolation(
      resource.id,
      normalizedPolicy,
    );

    if (Array.isArray(normalizedPolicy.exports)) {
      ctx.registry.visibilityTracker.recordExports(
        resource.id,
        normalizedPolicy.exports,
      );
    }
  }
}

/**
 * Normalizes isolation entries - exported for testing purposes.
 */
export function normalizeIsolationEntries<TEntry extends object>(
  ctx: ValidatorContext,
  input: {
    entries: ReadonlyArray<unknown>;
    policyResourceId?: string;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  },
): Array<TEntry> {
  const normalizedEntries: Array<TEntry> = [];

  for (const entry of input.entries) {
    // scope() entries � validate inner targets
    if (isIsolationScope(entry)) {
      const scopeEntry = entry as IsolationScope;
      const expandedTargets = expandScopeTargets(ctx, {
        targets: scopeEntry.targets,
        policyResourceId: input.policyResourceId,
        onInvalidEntry: input.onInvalidEntry,
        onUnknownTarget: input.onUnknownTarget,
      });
      const expandedScope = scope(expandedTargets, scopeEntry.channels);
      normalizedEntries.push(expandedScope as unknown as TEntry);
      continue;
    }

    // Structural subtree filters bypass the id-resolution path
    if (isSubtreeFilter(entry)) {
      const normalizedFilter = normalizeSubtreeFilterResourceId(ctx, {
        filter: entry,
        onInvalidEntry: input.onInvalidEntry,
        onUnknownTarget: input.onUnknownTarget,
      });
      normalizedEntries.push(normalizedFilter as unknown as TEntry);
      continue;
    }

    // Bare strings are not valid in deny/only.
    if (typeof entry === "string") {
      input.onInvalidEntry(entry);
    }

    const resolvedId = resolveKnownIsolationTargetId(ctx, {
      entry,
      onInvalidEntry: input.onInvalidEntry,
      onUnknownTarget: input.onUnknownTarget,
    });

    if (isTag(entry)) {
      normalizedEntries.push(
        (entry.id === resolvedId
          ? entry
          : { ...entry, id: resolvedId }) as TEntry,
      );
      continue;
    }

    normalizedEntries.push(
      normalizeResolvedDefinitionEntry<TEntry>(
        entry,
        resolvedId,
        input.onInvalidEntry,
      ),
    );
  }

  return normalizedEntries;
}

function expandScopeTargets(
  ctx: ValidatorContext,
  input: {
    targets: ReadonlyArray<IsolationScopeTarget>;
    policyResourceId?: string;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  },
): IsolationScopeTarget[] {
  const expanded: IsolationScopeTarget[] = [];

  for (const target of input.targets) {
    if (isSubtreeFilter(target)) {
      const normalizedFilter = normalizeSubtreeFilterResourceId(ctx, {
        filter: target,
        onInvalidEntry: input.onInvalidEntry,
        onUnknownTarget: input.onUnknownTarget,
      });
      expanded.push(normalizedFilter);
      continue;
    }

    if (typeof target === "string") {
      input.onInvalidEntry(target);
    }

    const resolvedId = resolveKnownIsolationTargetId(ctx, {
      entry: target,
      onInvalidEntry: input.onInvalidEntry,
      onUnknownTarget: input.onUnknownTarget,
    });

    if (isTag(target)) {
      expanded.push(
        target.id === resolvedId ? target : { ...target, id: resolvedId },
      );
      continue;
    }

    expanded.push(
      normalizeResolvedDefinitionEntry<IsolationScopeTarget>(
        target,
        resolvedId,
        input.onInvalidEntry,
      ),
    );
  }

  return expanded;
}

function normalizeResolvedDefinitionEntry<TEntry extends object>(
  entry: unknown,
  resolvedId: string,
  onInvalidEntry: (entry: unknown) => never,
): TEntry {
  if (typeof entry !== "object" || entry === null || !("id" in entry)) {
    onInvalidEntry(entry);
  }

  const currentId = (entry as { id?: unknown }).id;
  if (typeof currentId !== "string") {
    onInvalidEntry(entry);
  }

  if (currentId === resolvedId) {
    return entry as TEntry;
  }

  return {
    ...(entry as Record<string, unknown>),
    id: resolvedId,
  } as TEntry;
}

function resolveIsolationTargetId(
  ctx: ValidatorContext,
  entry: unknown,
): string | null {
  const resolved = ctx.resolveReferenceId(entry);
  return resolved ?? null;
}

function resolveKnownIsolationTargetId(
  ctx: ValidatorContext,
  input: {
    entry: unknown;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  },
): string {
  const resolvedId = resolveIsolationTargetId(ctx, input.entry);
  if (!resolvedId) {
    input.onInvalidEntry(input.entry);
  }
  if (!ctx.hasRegisteredId(resolvedId)) {
    input.onUnknownTarget(resolvedId);
  }
  return resolvedId;
}

function normalizeSubtreeFilterResourceId(
  ctx: ValidatorContext,
  input: {
    filter: IsolationSubtreeFilter;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  },
) {
  if (
    typeof input.filter.resourceId !== "string" ||
    input.filter.resourceId.length === 0
  ) {
    input.onInvalidEntry(input.filter);
  }

  const filterTypes = input.filter.types;
  if (!validateSubtreeFilterTypes(filterTypes)) {
    input.onInvalidEntry(input.filter);
  }

  const resourceReference = getSubtreeFilterResourceReference(input.filter);
  const resolvedResourceId =
    (resourceReference ? ctx.resolveReferenceId(resourceReference) : null) ??
    ctx.resolveReferenceId(input.filter.resourceId) ??
    input.filter.resourceId;

  if (!ctx.hasRegisteredId(resolvedResourceId)) {
    input.onUnknownTarget(resolvedResourceId);
  }

  if (resolvedResourceId === input.filter.resourceId) {
    return input.filter;
  }

  return {
    ...input.filter,
    resourceId: resolvedResourceId,
  };
}

function validateSubtreeFilterTypes(
  types: ReadonlyArray<unknown> | undefined,
): types is ReadonlyArray<ItemType> {
  if (types === undefined) {
    return true;
  }

  if (!Array.isArray(types)) {
    return false;
  }

  return types.every((type) => isSubtreeFilterItemType(type));
}

/**
 * Normalizes export entries - exported for testing purposes.
 */
export function normalizeExportEntries(
  ctx: ValidatorContext,
  input: {
    entries: ReadonlyArray<unknown>;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  },
): Array<IsolationExportsTarget> {
  const normalizedEntries: Array<IsolationExportsTarget> = [];

  for (const entry of input.entries) {
    if (typeof entry === "string") {
      input.onInvalidEntry(entry);
    }

    const resolvedId = resolveKnownIsolationTargetId(ctx, {
      entry,
      onInvalidEntry: input.onInvalidEntry,
      onUnknownTarget: input.onUnknownTarget,
    });

    if (isTag(entry)) {
      normalizedEntries.push(
        (entry.id === resolvedId
          ? entry
          : { ...entry, id: resolvedId }) as IsolationExportsTarget,
      );
      continue;
    }

    normalizedEntries.push(
      normalizeResolvedDefinitionEntry<IsolationExportsTarget>(
        entry,
        resolvedId,
        input.onInvalidEntry,
      ),
    );
  }

  return normalizedEntries;
}
