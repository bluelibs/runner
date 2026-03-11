import {
  isolateInvalidEntryError,
  isolateUnknownTargetError,
  isolateConflictError,
  isolateExportsUnknownTargetError,
  isolateInvalidExportsError,
} from "../../errors";
import type {
  IsolationWhitelistEntry,
  IsolationExportsTarget,
  IsolationPolicy,
  IsolationSubtreeFilter,
  IsolationTarget,
  ItemType,
} from "../../defs";
import { isTag } from "../../define";
import { scope } from "../../tools/scope";
import type { IsolationScopeTarget } from "../../tools/scope";
import {
  getSubtreeFilterResourceReference,
  isSubtreeFilterItemType,
} from "../../tools/subtreeOf";
import {
  classifyIsolationEntry,
  classifyScopeTarget,
} from "../../tools/classifyIsolationEntry";
import { resolveIsolationSelector } from "../utils/isolationSelectors";
import { getStoredIsolationPolicy } from "../../definers/isolatePolicy";
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
    const policy = getStoredIsolationPolicy(resource);
    if (!policy) {
      continue;
    }

    const denyPresent = "deny" in policy && policy.deny !== undefined;
    const onlyPresent = "only" in policy && policy.only !== undefined;
    const whitelistPresent =
      "whitelist" in policy && policy.whitelist !== undefined;

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

    if (whitelistPresent && !Array.isArray(policy.whitelist)) {
      isolateInvalidEntryError.throw({
        policyResourceId: resource.id,
        entry: policy.whitelist,
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
      ...(whitelistPresent ? { whitelist: policy.whitelist } : {}),
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

    if (Array.isArray(policy.whitelist) && policy.whitelist.length > 0) {
      normalizedPolicy.whitelist = normalizeWhitelistEntries(ctx, {
        entries: policy.whitelist,
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
      });
    }

    resource.isolate = normalizedPolicy;
    ctx.registry.visibilityTracker.recordIsolation(
      resource.id,
      normalizedPolicy,
    );

    if (
      Array.isArray(normalizedPolicy.exports) ||
      normalizedPolicy.exports === "none"
    ) {
      ctx.registry.visibilityTracker.recordExports(
        resource.id,
        normalizedPolicy.exports === "none" ? [] : normalizedPolicy.exports,
      );
    }
  }
}

export function normalizeWhitelistEntries(
  ctx: ValidatorContext,
  input: {
    entries: ReadonlyArray<unknown>;
    policyResourceId?: string;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  },
): Array<IsolationWhitelistEntry> {
  const normalizedEntries: IsolationWhitelistEntry[] = [];

  for (const entry of input.entries) {
    if (!entry || typeof entry !== "object") {
      input.onInvalidEntry(entry);
    }

    const candidate = entry as {
      for?: ReadonlyArray<unknown>;
      targets?: ReadonlyArray<unknown>;
      channels?: unknown;
    };

    if (!Array.isArray(candidate.for) || candidate.for.length === 0) {
      input.onInvalidEntry(entry);
    }

    if (!Array.isArray(candidate.targets) || candidate.targets.length === 0) {
      input.onInvalidEntry(entry);
    }

    const normalizedFor = normalizeIsolationEntries<IsolationTarget>(ctx, {
      entries: candidate.for,
      policyResourceId: input.policyResourceId,
      onInvalidEntry: input.onInvalidEntry,
      onUnknownTarget: input.onUnknownTarget,
    });

    const normalizedTargets = normalizeIsolationEntries<IsolationTarget>(ctx, {
      entries: candidate.targets,
      policyResourceId: input.policyResourceId,
      onInvalidEntry: input.onInvalidEntry,
      onUnknownTarget: input.onUnknownTarget,
    });

    const channels = normalizeChannels(
      candidate.channels,
      input.onInvalidEntry,
      entry,
    );

    normalizedEntries.push({
      for: normalizedFor,
      targets: normalizedTargets,
      ...(channels ? { channels } : {}),
    });
  }

  return normalizedEntries;
}

type EntryErrorCallbacks = {
  onInvalidEntry: (entry: unknown) => never;
  onUnknownTarget: (targetId: string) => never;
};

/**
 * Resolves a tag or bare definition entry to its normalized form with a canonical id.
 */
function normalizeResolvedTarget<TEntry extends object>(
  ctx: ValidatorContext,
  entry: unknown,
  callbacks: EntryErrorCallbacks,
): TEntry {
  const resolvedId = resolveKnownIsolationTargetId(ctx, {
    entry,
    ...callbacks,
  });

  if (isTag(entry)) {
    return (
      entry.id === resolvedId ? entry : { ...entry, id: resolvedId }
    ) as TEntry;
  }

  return normalizeResolvedDefinitionEntry<TEntry>(
    entry as object & { id: string },
    resolvedId,
  );
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
  const callbacks: EntryErrorCallbacks = {
    onInvalidEntry: input.onInvalidEntry,
    onUnknownTarget: input.onUnknownTarget,
  };

  for (const entry of input.entries) {
    const classified = classifyIsolationEntry(entry);
    switch (classified.kind) {
      case "scope": {
        const expandedTargets = expandScopeTargets(ctx, {
          targets: classified.scope.targets,
          policyResourceId: input.policyResourceId,
          ...callbacks,
        });
        normalizedEntries.push(
          scope(
            expandedTargets,
            classified.scope.channels,
          ) as unknown as TEntry,
        );
        break;
      }
      case "subtreeFilter":
        normalizedEntries.push(
          normalizeSubtreeFilterResourceId(ctx, {
            filter: classified.filter,
            ...callbacks,
          }) as unknown as TEntry,
        );
        break;
      case "string":
        input.onInvalidEntry(entry);
      // falls through (onInvalidEntry returns never)
      case "tag":
      case "definition":
        normalizedEntries.push(
          normalizeResolvedTarget<TEntry>(ctx, entry, callbacks),
        );
        break;
      case "unknown":
        input.onInvalidEntry(entry);
    }
  }

  return normalizedEntries;
}

function expandScopeTargets(
  ctx: ValidatorContext,
  input: {
    targets: ReadonlyArray<unknown>;
    policyResourceId?: string;
    onInvalidEntry: (entry: unknown) => never;
    onUnknownTarget: (targetId: string) => never;
  },
): IsolationScopeTarget[] {
  const expanded: IsolationScopeTarget[] = [];
  const callbacks: EntryErrorCallbacks = {
    onInvalidEntry: input.onInvalidEntry,
    onUnknownTarget: input.onUnknownTarget,
  };

  for (const target of input.targets) {
    const classified = classifyScopeTarget(target);
    switch (classified.kind) {
      case "subtreeFilter":
        expanded.push(
          normalizeSubtreeFilterResourceId(ctx, {
            filter: classified.filter,
            ...callbacks,
          }),
        );
        break;
      case "wildcard":
        expanded.push("*");
        break;
      case "string":
        if (classified.value.length === 0) {
          input.onInvalidEntry(target);
        }
        for (const resolvedTarget of resolveSelectorTargets(
          ctx,
          classified.value,
          input.onUnknownTarget,
        )) {
          expanded.push(resolvedTarget);
        }
        break;
      case "tag":
      case "definition":
        expanded.push(
          normalizeResolvedTarget(
            ctx,
            target,
            callbacks,
          ) as IsolationScopeTarget,
        );
        break;
      case "unknown":
        input.onInvalidEntry(target);
    }
  }

  return expanded;
}

function resolveSelectorTargets(
  ctx: ValidatorContext,
  selector: string,
  onUnknownTarget: (targetId: string) => never,
): IsolationScopeTarget[] {
  const resolvedIds = resolveIsolationSelector(
    selector,
    ctx.getRegisteredIds(),
  );
  if (resolvedIds.length === 0) {
    onUnknownTarget(selector);
  }

  return resolvedIds.map(
    (resolvedId) => ({ id: resolvedId }) as IsolationScopeTarget,
  );
}

function normalizeResolvedDefinitionEntry<TEntry extends object>(
  entry: object & { id: string },
  resolvedId: string,
): TEntry {
  if (entry.id === resolvedId) {
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

function normalizeChannels(
  value: unknown,
  onInvalidEntry: (entry: unknown) => never,
  originalEntry: unknown,
) {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    onInvalidEntry(originalEntry);
  }

  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "dependencies",
    "listening",
    "tagging",
    "middleware",
  ]);

  for (const [key, channelValue] of Object.entries(candidate)) {
    if (!allowedKeys.has(key) || typeof channelValue !== "boolean") {
      onInvalidEntry(originalEntry);
    }
  }

  return candidate as IsolationWhitelistEntry["channels"];
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
  const callbacks: EntryErrorCallbacks = {
    onInvalidEntry: input.onInvalidEntry,
    onUnknownTarget: input.onUnknownTarget,
  };

  for (const entry of input.entries) {
    const classified = classifyScopeTarget(entry);
    switch (classified.kind) {
      case "string":
      case "unknown":
      case "subtreeFilter":
        input.onInvalidEntry(entry);
      // falls through (onInvalidEntry returns never)
      case "tag":
      case "definition":
        normalizedEntries.push(
          normalizeResolvedTarget<IsolationExportsTarget>(
            ctx,
            entry,
            callbacks,
          ),
        );
        break;
    }
  }

  return normalizedEntries;
}
