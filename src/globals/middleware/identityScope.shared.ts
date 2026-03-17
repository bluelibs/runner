import { asyncContexts } from "../../asyncContexts";
import {
  GLOBAL_IDENTITY_NAMESPACE,
  IDENTITY_SCOPE_SEPARATOR,
} from "../../async-contexts/identity.asyncContext";
import {
  identityContextRequiredError,
  identityInvalidContextError,
} from "../../errors";
import type { IdentityContextValue } from "../../public-types";
import { Match } from "../../tools/check";

/**
 * Controls whether identity-aware middleware partitions its internal state by
 * the active identity payload.
 *
 * Omit the option to keep the shared cross-identity keyspace.
 * Provide `{ tenant: true }` to require tenant partitioning.
 * Add `user: true` for `<tenantId>:<userId>:...` partitioning.
 * Set `required: false` when identity should refine the key only when present.
 */
export interface IdentityScopeConfig {
  /**
   * Tenant partitioning is always explicit when identity scoping is enabled.
   */
  tenant: true;
  /**
   * Append `userId` after `tenantId` when it exists.
   *
   * When `required` is not set to `false`, `userId` becomes mandatory.
   */
  user?: boolean;
  /**
   * Require the scoped identity fields to exist.
   *
   * Defaults to `true`. Set to `false` when identity should only refine the
   * key when available.
   */
  required?: boolean;
}

interface NormalizedIdentityScopeConfig {
  required: boolean;
  tenant: true;
  user: boolean;
}

export interface IdentityScopedMiddlewareConfig {
  /**
   * Controls identity partitioning for middleware-managed state.
   *
   * Omit this option to keep the shared cross-identity keyspace.
   */
  identityScope?: IdentityScopeConfig;
}

function isIdentityScopeConfig(value: unknown): value is IdentityScopeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);

  return (
    candidate.tenant === true &&
    (candidate.user === undefined || typeof candidate.user === "boolean") &&
    (candidate.required === undefined ||
      typeof candidate.required === "boolean") &&
    keys.every(
      (key) => key === "tenant" || key === "user" || key === "required",
    )
  );
}

export const identityScopePattern = Match.Optional(
  Match.Where((value: unknown): value is IdentityScopeConfig =>
    isIdentityScopeConfig(value),
  ),
);

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
 * Applies the runtime defaults for an explicit `identityScope` config.
 */
export function normalizeIdentityScopeConfig(
  identityScope: IdentityScopeConfig | undefined,
): NormalizedIdentityScopeConfig | undefined {
  if (identityScope === undefined) {
    return undefined;
  }

  return {
    required: identityScope.required ?? true,
    tenant: true,
    user: identityScope.user ?? false,
  };
}

/**
 * Reads and validates the active identity payload for middleware helpers.
 */
export function resolveIdentityContext(
  identityScope: IdentityScopeConfig | undefined,
  readIdentity: () => unknown = () => asyncContexts.identity.tryUse(),
): IdentityContextValue | undefined {
  const scope = normalizeIdentityScopeConfig(identityScope);
  if (!scope) {
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
  if (!scope) {
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
