import { Match } from "../../tools/check";

/**
 * Controls whether identity-aware middleware partitions its internal state by
 * the active identity payload.
 *
 * Omit the option to use default automatic tenant partitioning when identity exists.
 * Provide `{ tenant: true }` to require tenant partitioning explicitly.
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
   * Omit this option to use automatic tenant partitioning when identity exists.
   */
  identityScope?: IdentityScopeConfig;
}

export function isIdentityScopeConfig(
  value: unknown,
): value is IdentityScopeConfig {
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

/**
 * Applies the runtime defaults for `identityScope`, including the secure
 * automatic tenant partitioning used when the option is omitted.
 */
export function normalizeIdentityScopeConfig(
  identityScope: IdentityScopeConfig | undefined,
): NormalizedIdentityScopeConfig {
  if (identityScope === undefined) {
    return {
      required: false,
      tenant: true,
      user: false,
    };
  }

  return {
    required: identityScope.required ?? true,
    tenant: true,
    user: identityScope.user ?? false,
  };
}

/**
 * Returns true when two identityScope values represent the same runtime policy.
 */
export function identityScopesMatch(
  left: IdentityScopeConfig | undefined,
  right: IdentityScopeConfig | undefined,
): boolean {
  const normalizedLeft = normalizeIdentityScopeConfig(left);
  const normalizedRight = normalizeIdentityScopeConfig(right);

  return (
    normalizedLeft?.required === normalizedRight?.required &&
    normalizedLeft?.tenant === normalizedRight?.tenant &&
    normalizedLeft?.user === normalizedRight?.user
  );
}
