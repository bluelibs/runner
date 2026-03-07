import type {
  NormalizedResourceSubtreePolicy,
  ResourceSubtreePolicy,
  SubtreeElementValidator,
  SubtreeResourceMiddlewareEntry,
  SubtreeTaskMiddlewareEntry,
} from "../types/subtree";

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}

function hasConditionalSubtreeMiddlewareEntry<TEntry extends object>(
  entry: TEntry,
): entry is Extract<TEntry, { use: object }> {
  return "use" in entry;
}

function cloneSubtreeConditionalMiddlewareEntry<TEntry extends object>(
  entry: TEntry,
): TEntry {
  if (hasConditionalSubtreeMiddlewareEntry(entry)) {
    return {
      ...(entry as object),
    } as TEntry;
  }

  return entry;
}

function cloneSubtreeMiddlewareBranch<TEntry extends object>(
  branch: { middleware: TEntry[] } | undefined,
): { middleware: TEntry[] } | undefined {
  if (!branch) {
    return undefined;
  }

  return {
    middleware: branch.middleware.map(cloneSubtreeConditionalMiddlewareEntry),
  };
}

function cloneNormalizedSubtreePolicy(
  policy: NormalizedResourceSubtreePolicy | undefined,
): NormalizedResourceSubtreePolicy {
  if (!policy) {
    return {};
  }

  return {
    tasks: cloneSubtreeMiddlewareBranch<SubtreeTaskMiddlewareEntry>(
      policy.tasks,
    ),
    resources: cloneSubtreeMiddlewareBranch<SubtreeResourceMiddlewareEntry>(
      policy.resources,
    ),
    ...("validate" in policy
      ? {
          validate: [...(policy.validate ?? [])],
        }
      : {}),
  };
}

export function normalizeResourceSubtreePolicy(
  policy: ResourceSubtreePolicy | undefined,
): NormalizedResourceSubtreePolicy | undefined {
  if (!policy) {
    return;
  }

  const normalized: NormalizedResourceSubtreePolicy = {};

  if (policy.tasks) {
    normalized.tasks = {
      middleware: (policy.tasks.middleware ?? []).map(
        cloneSubtreeConditionalMiddlewareEntry<SubtreeTaskMiddlewareEntry>,
      ),
    };
  }

  if (policy.resources) {
    normalized.resources = {
      middleware: (policy.resources.middleware ?? []).map(
        cloneSubtreeConditionalMiddlewareEntry<SubtreeResourceMiddlewareEntry>,
      ),
    };
  }

  if ("validate" in policy) {
    normalized.validate = toArray<SubtreeElementValidator>(policy.validate);
  }

  return normalized;
}

function mergeSubtreeMiddlewareBranch<
  TEntry,
  TBranch extends { middleware: TEntry[] },
>(
  existing: TBranch | undefined,
  incoming: TBranch,
  override: boolean,
): TBranch {
  if (!existing || override) {
    return {
      middleware: [...incoming.middleware],
    } as TBranch;
  }

  return {
    middleware: [...existing.middleware, ...incoming.middleware],
  } as TBranch;
}

export function mergeResourceSubtreePolicy(
  existing: NormalizedResourceSubtreePolicy | undefined,
  incoming: ResourceSubtreePolicy,
  options?: {
    override?: boolean;
  },
): NormalizedResourceSubtreePolicy {
  const normalizedIncoming = normalizeResourceSubtreePolicy(incoming);
  if (!normalizedIncoming) {
    return cloneNormalizedSubtreePolicy(existing);
  }

  const override = options?.override === true;
  const merged = cloneNormalizedSubtreePolicy(existing);

  if (normalizedIncoming.tasks) {
    merged.tasks = mergeSubtreeMiddlewareBranch(
      merged.tasks,
      normalizedIncoming.tasks,
      override,
    );
  }

  if (normalizedIncoming.resources) {
    merged.resources = mergeSubtreeMiddlewareBranch(
      merged.resources,
      normalizedIncoming.resources,
      override,
    );
  }

  if ("validate" in normalizedIncoming) {
    const incomingValidators = normalizedIncoming.validate!;
    merged.validate =
      !merged.validate || override
        ? [...incomingValidators]
        : [...merged.validate, ...incomingValidators];
  }

  return merged;
}
