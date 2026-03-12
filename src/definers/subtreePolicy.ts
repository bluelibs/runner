import type {
  NormalizedResourceSubtreePolicy,
  ResourceSubtreePolicyDeclaration,
  ResourceSubtreePolicyInput,
  ResourceSubtreePolicyList,
  ResourceSubtreePolicy,
  SubtreeElementValidator,
  SubtreeEventValidator,
  SubtreeHookValidator,
  SubtreeResourceMiddlewareValidator,
  SubtreeResourceValidator,
  SubtreeTagValidator,
  SubtreeResourceMiddlewareEntry,
  SubtreeTaskMiddlewareValidator,
  SubtreeTaskMiddlewareEntry,
  SubtreeTaskValidator,
} from "../types/subtree";
import { isResourceMiddleware, isTaskMiddleware } from "./tools";

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}

function cloneValidatorArray<T>(value: T[] | undefined): T[] {
  return value === undefined ? [] : [...value];
}

function hasConditionalSubtreeMiddlewareEntry<TEntry extends object>(
  entry: TEntry,
): entry is Extract<TEntry, { use: object }> {
  if (isTaskMiddleware(entry) || isResourceMiddleware(entry)) {
    return false;
  }

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

function cloneSubtreeMiddlewareBranch<TEntry extends object, TValidator>(
  branch:
    | {
        middleware: TEntry[];
        validate?: TValidator[];
      }
    | undefined,
): { middleware: TEntry[]; validate?: TValidator[] } | undefined {
  if (!branch) {
    return undefined;
  }

  return {
    middleware: branch.middleware.map(cloneSubtreeConditionalMiddlewareEntry),
    ...("validate" in branch
      ? { validate: cloneValidatorArray(branch.validate) }
      : {}),
  };
}

function cloneSubtreeValidateBranch<TValidator>(
  branch: { validate?: TValidator[] } | undefined,
): { validate?: TValidator[] } | undefined {
  if (!branch) {
    return undefined;
  }

  return {
    ...("validate" in branch
      ? { validate: cloneValidatorArray(branch.validate) }
      : {}),
  };
}

function cloneNormalizedSubtreePolicy(
  policy: NormalizedResourceSubtreePolicy | undefined,
): NormalizedResourceSubtreePolicy {
  if (!policy) {
    return {};
  }

  return {
    tasks: cloneSubtreeMiddlewareBranch<
      SubtreeTaskMiddlewareEntry,
      SubtreeTaskValidator
    >(policy.tasks),
    resources: cloneSubtreeMiddlewareBranch<
      SubtreeResourceMiddlewareEntry,
      SubtreeResourceValidator
    >(policy.resources),
    hooks: cloneSubtreeValidateBranch<SubtreeHookValidator>(policy.hooks),
    events: cloneSubtreeValidateBranch<SubtreeEventValidator>(policy.events),
    tags: cloneSubtreeValidateBranch<SubtreeTagValidator>(policy.tags),
    taskMiddleware: cloneSubtreeValidateBranch<SubtreeTaskMiddlewareValidator>(
      policy.taskMiddleware,
    ),
    resourceMiddleware:
      cloneSubtreeValidateBranch<SubtreeResourceMiddlewareValidator>(
        policy.resourceMiddleware,
      ),
    ...("validate" in policy
      ? {
          validate: cloneValidatorArray(policy.validate),
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
      ...("validate" in policy.tasks
        ? {
            validate: toArray<SubtreeTaskValidator>(policy.tasks.validate),
          }
        : {}),
    };
  }

  if (policy.resources) {
    normalized.resources = {
      middleware: (policy.resources.middleware ?? []).map(
        cloneSubtreeConditionalMiddlewareEntry<SubtreeResourceMiddlewareEntry>,
      ),
      ...("validate" in policy.resources
        ? {
            validate: toArray<SubtreeResourceValidator>(
              policy.resources.validate,
            ),
          }
        : {}),
    };
  }

  if (policy.hooks) {
    normalized.hooks =
      "validate" in policy.hooks
        ? {
            validate: toArray<SubtreeHookValidator>(policy.hooks.validate),
          }
        : {};
  }

  if (policy.events) {
    normalized.events =
      "validate" in policy.events
        ? {
            validate: toArray<SubtreeEventValidator>(policy.events.validate),
          }
        : {};
  }

  if (policy.tags) {
    normalized.tags =
      "validate" in policy.tags
        ? {
            validate: toArray<SubtreeTagValidator>(policy.tags.validate),
          }
        : {};
  }

  if (policy.taskMiddleware) {
    normalized.taskMiddleware =
      "validate" in policy.taskMiddleware
        ? {
            validate: toArray<SubtreeTaskMiddlewareValidator>(
              policy.taskMiddleware.validate,
            ),
          }
        : {};
  }

  if (policy.resourceMiddleware) {
    normalized.resourceMiddleware =
      "validate" in policy.resourceMiddleware
        ? {
            validate: toArray<SubtreeResourceMiddlewareValidator>(
              policy.resourceMiddleware.validate,
            ),
          }
        : {};
  }

  if ("validate" in policy) {
    normalized.validate = toArray<SubtreeElementValidator>(policy.validate);
  }

  return normalized;
}

function toSubtreePolicyArray(
  policy: ResourceSubtreePolicyList | undefined,
): ResourceSubtreePolicy[] {
  if (policy === undefined) {
    return [];
  }

  return Array.isArray(policy) ? [...policy] : [policy];
}

function mergeSubtreePolicyList(
  existing: NormalizedResourceSubtreePolicy | undefined,
  incoming: ResourceSubtreePolicyList | undefined,
  options?: {
    override?: boolean;
  },
): NormalizedResourceSubtreePolicy {
  let merged = cloneNormalizedSubtreePolicy(existing);

  for (const policy of toSubtreePolicyArray(incoming)) {
    merged = mergeResourceSubtreePolicy(merged, policy, options);
  }

  return merged;
}

function mergeSubtreeMiddlewareBranch<
  TEntry,
  TValidator,
  TBranch extends { middleware: TEntry[]; validate?: TValidator[] },
>(
  existing: TBranch | undefined,
  incoming: TBranch,
  override: boolean,
): TBranch {
  if (!existing || override) {
    return {
      middleware: [...incoming.middleware],
      ...("validate" in incoming
        ? { validate: cloneValidatorArray(incoming.validate) }
        : {}),
    } as TBranch;
  }

  return {
    middleware: [...existing.middleware, ...incoming.middleware],
    ...("validate" in incoming
      ? {
          validate: [
            ...cloneValidatorArray(existing.validate),
            ...cloneValidatorArray(incoming.validate),
          ],
        }
      : "validate" in existing
        ? {
            validate: cloneValidatorArray(existing.validate),
          }
        : {}),
  } as TBranch;
}

function mergeSubtreeValidateBranch<TValidator>(
  existing: { validate?: TValidator[] } | undefined,
  incoming: { validate?: TValidator[] },
  override: boolean,
): { validate?: TValidator[] } {
  if (!existing || override) {
    return {
      ...("validate" in incoming
        ? { validate: cloneValidatorArray(incoming.validate) }
        : {}),
    };
  }

  if ("validate" in incoming) {
    return {
      validate: [
        ...cloneValidatorArray(existing.validate),
        ...cloneValidatorArray(incoming.validate),
      ],
    };
  }

  return {
    ...("validate" in existing
      ? { validate: cloneValidatorArray(existing.validate) }
      : {}),
  };
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

  if (normalizedIncoming.hooks) {
    merged.hooks = mergeSubtreeValidateBranch(
      merged.hooks,
      normalizedIncoming.hooks,
      override,
    );
  }

  if (normalizedIncoming.events) {
    merged.events = mergeSubtreeValidateBranch(
      merged.events,
      normalizedIncoming.events,
      override,
    );
  }

  if (normalizedIncoming.tags) {
    merged.tags = mergeSubtreeValidateBranch(
      merged.tags,
      normalizedIncoming.tags,
      override,
    );
  }

  if (normalizedIncoming.taskMiddleware) {
    merged.taskMiddleware = mergeSubtreeValidateBranch(
      merged.taskMiddleware,
      normalizedIncoming.taskMiddleware,
      override,
    );
  }

  if (normalizedIncoming.resourceMiddleware) {
    merged.resourceMiddleware = mergeSubtreeValidateBranch(
      merged.resourceMiddleware,
      normalizedIncoming.resourceMiddleware,
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

export function createSubtreePolicyDeclaration<TConfig>(
  policy: ResourceSubtreePolicyInput<TConfig>,
  options?: {
    override?: boolean;
  },
): ResourceSubtreePolicyDeclaration<TConfig> {
  return {
    policy,
    ...(options ? { options: { override: options.override } } : {}),
  };
}

export function mergeResourceSubtreeDeclarations<TConfig>(
  existing:
    | ReadonlyArray<ResourceSubtreePolicyDeclaration<TConfig>>
    | undefined,
  incoming: ResourceSubtreePolicyInput<TConfig>,
  options?: {
    override?: boolean;
  },
): ReadonlyArray<ResourceSubtreePolicyDeclaration<TConfig>> {
  return Object.freeze([
    ...(existing ?? []),
    createSubtreePolicyDeclaration(incoming, options),
  ]);
}

export function resolveResourceSubtreeDeclarations<TConfig>(
  declarations:
    | ReadonlyArray<ResourceSubtreePolicyDeclaration<TConfig>>
    | undefined,
  config: TConfig,
): NormalizedResourceSubtreePolicy | undefined {
  let merged: NormalizedResourceSubtreePolicy | undefined;

  for (const declaration of declarations ?? []) {
    const policyList =
      typeof declaration.policy === "function"
        ? declaration.policy(config)
        : declaration.policy;
    merged = mergeSubtreePolicyList(merged, policyList, declaration.options);
  }

  return merged;
}

export function createDisplaySubtreePolicy<TConfig>(
  declarations:
    | ReadonlyArray<ResourceSubtreePolicyDeclaration<TConfig>>
    | undefined,
): ResourceSubtreePolicyInput<TConfig> | undefined {
  if (!declarations || declarations.length === 0) {
    return undefined;
  }

  const hasDynamic = declarations.some(
    (declaration) => typeof declaration.policy === "function",
  );

  if (!hasDynamic) {
    let merged: NormalizedResourceSubtreePolicy | undefined;

    for (const declaration of declarations) {
      merged = mergeSubtreePolicyList(
        merged,
        declaration.policy as ResourceSubtreePolicyList,
        declaration.options,
      );
    }

    return merged;
  }

  return (config: TConfig) =>
    resolveResourceSubtreeDeclarations(
      declarations,
      config,
    ) as NormalizedResourceSubtreePolicy;
}

export function getStoredSubtreePolicy<TConfig>(resource: {
  subtree?:
    | NormalizedResourceSubtreePolicy
    | ResourceSubtreePolicyInput<TConfig>;
}): NormalizedResourceSubtreePolicy | undefined {
  return resource.subtree as NormalizedResourceSubtreePolicy | undefined;
}
