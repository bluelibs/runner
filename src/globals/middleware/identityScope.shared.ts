import { asyncContexts } from "../../asyncContexts";
import {
  GLOBAL_IDENTITY_NAMESPACE,
  IDENTITY_SCOPE_SEPARATOR,
} from "../../async-contexts/identity.constants";
import {
  identityContextRequiredError,
  identityInvalidContextError,
} from "../../errors";
import type { IdentityContextValue } from "../../public-types";
import { Match } from "../../tools/check";
import {
  normalizeIdentityScopeConfig,
  type IdentityScopeConfig,
} from "./identityScope.contract";

export {
  identityScopePattern,
  identityScopesMatch,
  isIdentityScopeConfig,
  normalizeIdentityScopeConfig,
  type IdentityScopedMiddlewareConfig,
  type IdentityScopeConfig,
} from "./identityScope.contract";

function validateScopedIdentityField(
  fieldName: "tenantId" | "userId",
  value: unknown,
): string {
  if (!Match.test(value, Match.NonEmptyString)) {
    throw identityInvalidContextError.new({
      reason: `Identity "${fieldName}" must be a non-empty string when used for identity-scoped middleware.`,
    });
  }

  const validated = value;

  if (validated === GLOBAL_IDENTITY_NAMESPACE && fieldName === "tenantId") {
    throw identityInvalidContextError.new({
      reason: `Identity "tenantId" cannot be "${GLOBAL_IDENTITY_NAMESPACE}" because that value is reserved for the shared non-identity namespace.`,
    });
  }

  if (validated.includes(IDENTITY_SCOPE_SEPARATOR)) {
    throw identityInvalidContextError.new({
      reason: `Identity "${fieldName}" cannot contain "${IDENTITY_SCOPE_SEPARATOR}" because identity-scoped middleware keys use it as a separator.`,
    });
  }

  return validated;
}

/**
 * Reads and validates the active identity payload for middleware helpers.
 */
export function resolveIdentityContext(
  identityScope: IdentityScopeConfig | undefined,
  readIdentity: () => unknown = () => asyncContexts.identity.tryUse(),
): IdentityContextValue | undefined {
  const scope = normalizeIdentityScopeConfig(identityScope);
  if (!scope.tenant) {
    return undefined;
  }

  const identity = readIdentity();
  if (!identity || typeof identity !== "object") {
    if (scope.required) {
      throw identityContextRequiredError.new();
    }

    return undefined;
  }

  const candidate = identity as IdentityContextValue;
  if (candidate.tenantId === undefined) {
    if (scope.required) {
      throw identityContextRequiredError.new();
    }

    return undefined;
  }

  const validatedUserId =
    scope.user && candidate.userId !== undefined
      ? validateScopedIdentityField("userId", candidate.userId)
      : candidate.userId;

  return {
    ...candidate,
    tenantId: validateScopedIdentityField("tenantId", candidate.tenantId),
    userId: validatedUserId,
  };
}

/**
 * Builds the identity namespace prefix for middleware-managed keys.
 */
export function getIdentityScopePrefix(
  identityScope: IdentityScopeConfig | undefined,
  readIdentity?: () => unknown,
): string | undefined {
  const scope = normalizeIdentityScopeConfig(identityScope);
  if (!scope.tenant) {
    return undefined;
  }

  const identity = resolveIdentityContext(
    identityScope,
    readIdentity ?? (() => asyncContexts.identity.tryUse()),
  );

  if (!identity?.tenantId) {
    return undefined;
  }

  if (!scope.user || !identity.userId) {
    if (scope.user && scope.required) {
      throw identityInvalidContextError.new({
        reason:
          'Identity "userId" is required when identityScope.user is enabled.',
      });
    }

    return identity.tenantId;
  }

  return `${identity.tenantId}${IDENTITY_SCOPE_SEPARATOR}${identity.userId}`;
}

/**
 * Prefixes a middleware-managed key with the active identity namespace.
 */
export function applyIdentityScopeToKey(
  baseKey: string,
  identityScope: IdentityScopeConfig | undefined,
  readIdentity?: () => unknown,
): string {
  const prefix = getIdentityScopePrefix(identityScope, readIdentity);
  return prefix ? `${prefix}${IDENTITY_SCOPE_SEPARATOR}${baseKey}` : baseKey;
}

/**
 * Returns the active identity namespace or the shared global namespace marker.
 */
export function getIdentityNamespace(
  identityScope: IdentityScopeConfig | undefined,
  readIdentity?: () => unknown,
): string {
  return getIdentityScopePrefix(identityScope, readIdentity) ?? "__global__";
}
