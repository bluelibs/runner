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
 * - `"auto"`: partition by `tenantId` when it exists, otherwise fall back to
 *   the shared keyspace
 * - `"auto:userId"`: same as `"auto"`, but append `userId` when it exists
 * - `"required"`: require a valid `tenantId` and fail fast when it is missing
 * - `"required:userId"`: same as `"required"`, but append `userId` when it
 *   exists
 * - `"full"`: require both `tenantId` and `userId` and prefix keys as
 *   `<tenantId>:<userId>:...`
 * - `"off"`: disable identity partitioning and use the shared cross-identity
 *   keyspace
 */
export type IdentityScopeMode =
  | "auto"
  | "auto:userId"
  | "required"
  | "required:userId"
  | "full"
  | "off";
export type IdentityScopeConfig = IdentityScopeMode;

export interface IdentityScopedMiddlewareConfig {
  /**
   * Controls identity partitioning for middleware-managed state.
   *
   * Omit this option for the default `"auto"` behavior.
   */
  identityScope?: IdentityScopeConfig;
}

export const DEFAULT_IDENTITY_SCOPE = "auto";
const USER_ID_SCOPE_SUFFIX = ":userId";

function isIdentityScopeMode(value: unknown): value is IdentityScopeMode {
  return (
    value === "auto" ||
    value === "auto:userId" ||
    value === "required" ||
    value === "required:userId" ||
    value === "full" ||
    value === "off"
  );
}

export const identityScopePattern = Match.Optional(
  Match.Where((value: unknown): value is IdentityScopeConfig =>
    isIdentityScopeMode(value),
  ),
);

function requiresIdentity(mode: IdentityScopeMode): boolean {
  return mode === "required" || mode === "required:userId" || mode === "full";
}

function includesUserIdScope(mode: IdentityScopeMode): boolean {
  return mode === "full" || mode.endsWith(USER_ID_SCOPE_SUFFIX);
}

function requiresUserId(mode: IdentityScopeMode): boolean {
  return mode === "full";
}

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

export function getIdentityScopeMode(
  identityScope: IdentityScopeConfig | undefined,
): IdentityScopeMode {
  if (identityScope === undefined) {
    return DEFAULT_IDENTITY_SCOPE;
  }

  return identityScope;
}

export function resolveIdentityContext(
  identityScope: IdentityScopeConfig | undefined,
  readIdentity: () => unknown = () => asyncContexts.identity.tryUse(),
): IdentityContextValue | undefined {
  const mode = getIdentityScopeMode(identityScope);
  if (mode === "off") {
    return undefined;
  }

  const identity = readIdentity();
  if (!identity || typeof identity !== "object") {
    if (requiresIdentity(mode)) {
      throw identityContextRequiredError.new();
    }

    return undefined;
  }

  const candidate = identity as IdentityContextValue;
  if (candidate.tenantId === undefined) {
    if (requiresIdentity(mode)) {
      throw identityContextRequiredError.new();
    }

    return undefined;
  }

  return {
    ...candidate,
    tenantId: validateScopedIdentityField("tenantId", candidate.tenantId),
    userId:
      candidate.userId === undefined
        ? undefined
        : validateScopedIdentityField("userId", candidate.userId),
  };
}

export function getIdentityScopePrefix(
  identityScope: IdentityScopeConfig | undefined,
  readIdentity?: () => unknown,
): string | undefined {
  const mode = getIdentityScopeMode(identityScope);
  const identity = resolveIdentityContext(
    mode,
    readIdentity ?? (() => asyncContexts.identity.tryUse()),
  );

  if (!identity?.tenantId) {
    return undefined;
  }

  if (!includesUserIdScope(mode) || !identity.userId) {
    if (requiresUserId(mode)) {
      throw identityInvalidContextError.new({
        reason: 'Identity "userId" is required when identityScope is "full".',
      });
    }

    return identity.tenantId;
  }

  return `${identity.tenantId}${IDENTITY_SCOPE_SEPARATOR}${identity.userId}`;
}

export function applyIdentityScopeToKey(
  baseKey: string,
  identityScope: IdentityScopeConfig | undefined,
  readIdentity?: () => unknown,
): string {
  const prefix = getIdentityScopePrefix(identityScope, readIdentity);
  return prefix ? `${prefix}${IDENTITY_SCOPE_SEPARATOR}${baseKey}` : baseKey;
}

export function getIdentityNamespace(
  identityScope: IdentityScopeConfig | undefined,
  readIdentity?: () => unknown,
): string {
  return getIdentityScopePrefix(identityScope, readIdentity) ?? "__global__";
}
