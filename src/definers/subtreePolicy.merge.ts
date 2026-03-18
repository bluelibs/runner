import type {
  NormalizedResourceSubtreePolicy,
  ResourceSubtreePolicy,
  ResourceSubtreePolicyList,
  SubtreeTaskMiddlewareEntry,
  SubtreeTaskValidator,
} from "../types/subtree";
import type { IdentityRequirementConfig } from "../public-types";
import { validationError } from "../errors";
import { cloneIdentityRequirementConfig } from "../globals/middleware/identityRequirement.shared";
import type { IdentityScopeConfig } from "../globals/middleware/identityScope.shared";
import { identityScopesMatch } from "../globals/middleware/identityScope.contract";
import {
  cloneNormalizedSubtreePolicy,
  cloneSubtreeConditionalMiddlewareEntry,
  cloneValidatorArray,
} from "./subtreePolicy.clone";
import { normalizeResourceSubtreePolicy } from "./subtreePolicy.normalize";

function toSubtreePolicyArray(
  policy: ResourceSubtreePolicyList | undefined,
): ResourceSubtreePolicy[] {
  if (policy === undefined) {
    return [];
  }

  return Array.isArray(policy) ? [...policy] : [policy];
}

export function mergeSubtreePolicyList(
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
  TBranch extends {
    middleware: TEntry[];
    validate?: TValidator[];
  },
>(
  existing: TBranch | undefined,
  incoming: TBranch,
  override: boolean,
): TBranch {
  if (!existing) {
    return {
      middleware: [...incoming.middleware],
      ...("validate" in incoming
        ? { validate: cloneValidatorArray(incoming.validate) }
        : {}),
    } as TBranch;
  }

  if (override) {
    return {
      middleware: [...incoming.middleware],
      ...("validate" in incoming
        ? { validate: cloneValidatorArray(incoming.validate) }
        : "validate" in existing
          ? { validate: cloneValidatorArray(existing.validate) }
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

function mergeSubtreeTaskBranch(
  existing:
    | {
        middleware: SubtreeTaskMiddlewareEntry[];
        identity?: IdentityRequirementConfig[];
        validate?: SubtreeTaskValidator[];
      }
    | undefined,
  incoming: {
    middleware: SubtreeTaskMiddlewareEntry[];
    identity?: IdentityRequirementConfig[];
    validate?: SubtreeTaskValidator[];
  },
  override: boolean,
):
  | {
      middleware: SubtreeTaskMiddlewareEntry[];
      identity?: IdentityRequirementConfig[];
      validate?: SubtreeTaskValidator[];
    }
  | undefined {
  const cloneIdentityArray = (
    value: IdentityRequirementConfig[] | undefined,
  ): IdentityRequirementConfig[] | undefined =>
    value?.map(cloneIdentityRequirementConfig);

  if (!existing) {
    return {
      middleware: incoming.middleware.map(
        cloneSubtreeConditionalMiddlewareEntry<SubtreeTaskMiddlewareEntry>,
      ),
      ...("identity" in incoming
        ? { identity: cloneIdentityArray(incoming.identity) }
        : {}),
      ...("validate" in incoming
        ? { validate: cloneValidatorArray(incoming.validate) }
        : {}),
    };
  }

  if (override) {
    return {
      middleware: incoming.middleware.map(
        cloneSubtreeConditionalMiddlewareEntry<SubtreeTaskMiddlewareEntry>,
      ),
      ...("identity" in incoming
        ? { identity: cloneIdentityArray(incoming.identity) }
        : "identity" in existing
          ? { identity: cloneIdentityArray(existing.identity) }
          : {}),
      ...("validate" in incoming
        ? { validate: cloneValidatorArray(incoming.validate) }
        : "validate" in existing
          ? { validate: cloneValidatorArray(existing.validate) }
          : {}),
    };
  }

  return {
    middleware: [
      ...existing.middleware.map(
        cloneSubtreeConditionalMiddlewareEntry<SubtreeTaskMiddlewareEntry>,
      ),
      ...incoming.middleware.map(
        cloneSubtreeConditionalMiddlewareEntry<SubtreeTaskMiddlewareEntry>,
      ),
    ],
    // The incoming side is guaranteed by normalization whenever this branch
    // runs; only the existing side can legitimately be absent.
    ...("identity" in incoming
      ? {
          identity: [
            ...(cloneIdentityArray(existing.identity) ?? []),
            ...cloneIdentityArray(incoming.identity)!,
          ],
        }
      : "identity" in existing
        ? { identity: cloneIdentityArray(existing.identity) }
        : {}),
    ...("validate" in incoming
      ? {
          validate: [
            ...cloneValidatorArray(existing.validate),
            ...cloneValidatorArray(incoming.validate),
          ],
        }
      : "validate" in existing
        ? { validate: cloneValidatorArray(existing.validate) }
        : {}),
  };
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

function mergeSubtreeMiddlewarePolicyBranch(
  existing:
    | {
        identityScope?: IdentityScopeConfig;
      }
    | undefined,
  incoming: {
    identityScope?: IdentityScopeConfig;
  },
  override: boolean,
):
  | {
      identityScope?: IdentityScopeConfig;
    }
  | undefined {
  if (!existing) {
    return {
      ...("identityScope" in incoming
        ? { identityScope: incoming.identityScope }
        : {}),
    };
  }

  if (override) {
    return {
      ...("identityScope" in incoming
        ? { identityScope: incoming.identityScope }
        : "identityScope" in existing
          ? { identityScope: existing.identityScope }
          : {}),
    };
  }

  if (!("identityScope" in incoming)) {
    return {
      ...("identityScope" in existing
        ? { identityScope: existing.identityScope }
        : {}),
    };
  }

  if (!("identityScope" in existing)) {
    return {
      identityScope: incoming.identityScope,
    };
  }

  // Additive subtree policies should not silently change the effective
  // middleware partitioning model for the same owner resource.
  if (!identityScopesMatch(existing.identityScope, incoming.identityScope)) {
    validationError.throw({
      subject: "Subtree policy",
      id: "middleware.identityScope",
      originalError:
        "Additive subtree middleware.identityScope declarations must match exactly after normalization, or the later declaration must opt into override mode.",
    });
  }

  return {
    identityScope: existing.identityScope,
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
    merged.tasks = mergeSubtreeTaskBranch(
      merged.tasks,
      normalizedIncoming.tasks,
      override,
    );
  }

  if (normalizedIncoming.middleware) {
    merged.middleware = mergeSubtreeMiddlewarePolicyBranch(
      merged.middleware,
      normalizedIncoming.middleware,
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
