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

function cloneSubtreeConditionalMiddlewareEntry<TEntry>(entry: TEntry): TEntry {
  if (
    entry &&
    typeof entry === "object" &&
    "use" in entry &&
    (entry as { use?: unknown }).use !== undefined
  ) {
    return {
      use: (entry as { use: unknown }).use,
      when: (entry as { when?: unknown }).when,
    } as TEntry;
  }

  return entry;
}

function cloneNormalizedSubtreePolicy(
  policy: NormalizedResourceSubtreePolicy | undefined,
): NormalizedResourceSubtreePolicy {
  if (!policy) {
    return {};
  }

  return {
    tasks: policy.tasks
      ? {
          middleware: policy.tasks.middleware.map(
            cloneSubtreeConditionalMiddlewareEntry<SubtreeTaskMiddlewareEntry>,
          ),
        }
      : undefined,
    resources: policy.resources
      ? {
          middleware: policy.resources.middleware.map(
            cloneSubtreeConditionalMiddlewareEntry<SubtreeResourceMiddlewareEntry>,
          ),
        }
      : undefined,
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
  TBranch extends { middleware: unknown[] },
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

const mergeSubtreeTasksBranch = mergeSubtreeMiddlewareBranch;
const mergeSubtreeResourcesBranch = mergeSubtreeMiddlewareBranch;

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
    merged.tasks = mergeSubtreeTasksBranch(
      merged.tasks,
      normalizedIncoming.tasks,
      override,
    );
  }

  if (normalizedIncoming.resources) {
    merged.resources = mergeSubtreeResourcesBranch(
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
