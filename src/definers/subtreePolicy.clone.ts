import type {
  NormalizedResourceSubtreePolicy,
  SubtreeEventValidator,
  SubtreeHookValidator,
  SubtreeResourceMiddlewareEntry,
  SubtreeResourceMiddlewareValidator,
  SubtreeResourceValidator,
  SubtreeTagValidator,
  SubtreeTaskMiddlewareEntry,
  SubtreeTaskMiddlewareValidator,
  SubtreeTaskValidator,
} from "../types/subtree";
import type { IdentityRequirementConfig } from "../public-types";
import { cloneIdentityRequirementConfig } from "../globals/middleware/identityRequirement.shared";
import { isResourceMiddleware, isTaskMiddleware } from "./tools";

export function cloneValidatorArray<T>(value: T[] | undefined): T[] {
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

export function cloneSubtreeConditionalMiddlewareEntry<TEntry extends object>(
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
):
  | {
      middleware: TEntry[];
      validate?: TValidator[];
    }
  | undefined {
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

function cloneSubtreeTaskBranch(
  branch:
    | {
        middleware: SubtreeTaskMiddlewareEntry[];
        identity?: IdentityRequirementConfig[];
        validate?: SubtreeTaskValidator[];
      }
    | undefined,
):
  | {
      middleware: SubtreeTaskMiddlewareEntry[];
      identity?: IdentityRequirementConfig[];
      validate?: SubtreeTaskValidator[];
    }
  | undefined {
  if (!branch) {
    return undefined;
  }

  return {
    middleware: branch.middleware.map(
      cloneSubtreeConditionalMiddlewareEntry<SubtreeTaskMiddlewareEntry>,
    ),
    ...("identity" in branch
      ? {
          identity: branch.identity?.map(cloneIdentityRequirementConfig),
        }
      : {}),
    ...("validate" in branch
      ? { validate: cloneValidatorArray(branch.validate) }
      : {}),
  };
}

function cloneSubtreeMiddlewarePolicyBranch<TIdentityScope>(
  branch:
    | {
        identityScope?: TIdentityScope;
      }
    | undefined,
):
  | {
      identityScope?: TIdentityScope;
    }
  | undefined {
  if (!branch) {
    return undefined;
  }

  return {
    ...("identityScope" in branch
      ? { identityScope: branch.identityScope }
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

export function cloneNormalizedSubtreePolicy(
  policy: NormalizedResourceSubtreePolicy | undefined,
): NormalizedResourceSubtreePolicy {
  if (!policy) {
    return {};
  }

  return {
    tasks: cloneSubtreeTaskBranch(policy.tasks),
    middleware: cloneSubtreeMiddlewarePolicyBranch(policy.middleware),
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
