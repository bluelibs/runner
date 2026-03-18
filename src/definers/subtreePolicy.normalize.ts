import type {
  NormalizedResourceSubtreePolicy,
  ResourceSubtreePolicy,
  SubtreeElementValidator,
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
import { validationError } from "../errors";
import {
  isIdentityRequirementConfig,
  normalizeIdentityRequirementConfig,
} from "../globals/middleware/identityRequirement.shared";
import { isIdentityScopeConfig } from "../globals/middleware/identityScope.contract";
import { cloneSubtreeConditionalMiddlewareEntry } from "./subtreePolicy.clone";

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}

function isSubtreeTaskIdentityConfig(value: unknown): boolean {
  return value === undefined || isIdentityRequirementConfig(value);
}

function isSubtreeIdentityScopeConfig(value: unknown): boolean {
  return value === undefined || isIdentityScopeConfig(value);
}

export function normalizeResourceSubtreePolicy(
  policy: ResourceSubtreePolicy | undefined,
): NormalizedResourceSubtreePolicy | undefined {
  if (!policy) {
    return;
  }

  const normalized: NormalizedResourceSubtreePolicy = {};

  if (policy.tasks) {
    if (!isSubtreeTaskIdentityConfig(policy.tasks.identity)) {
      validationError.throw({
        subject: "Subtree policy",
        id: "tasks.identity",
        originalError:
          "Subtree tasks.identity must be a valid identity requirement object when provided.",
      });
    }

    const normalizedIdentity = normalizeIdentityRequirementConfig(
      policy.tasks.identity as IdentityRequirementConfig | undefined,
    );
    normalized.tasks = {
      middleware: (policy.tasks.middleware ?? []).map(
        cloneSubtreeConditionalMiddlewareEntry<SubtreeTaskMiddlewareEntry>,
      ),
      ...(normalizedIdentity
        ? {
            identity: [normalizedIdentity],
          }
        : {}),
      ...("validate" in policy.tasks
        ? {
            validate: toArray<SubtreeTaskValidator>(policy.tasks.validate),
          }
        : {}),
    };
  }

  if (policy.middleware) {
    if (!isSubtreeIdentityScopeConfig(policy.middleware.identityScope)) {
      validationError.throw({
        subject: "Subtree policy",
        id: "middleware.identityScope",
        originalError:
          "Subtree middleware.identityScope must be a valid identityScope config object when provided.",
      });
    }

    normalized.middleware = {
      ...("identityScope" in policy.middleware
        ? { identityScope: policy.middleware.identityScope }
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
