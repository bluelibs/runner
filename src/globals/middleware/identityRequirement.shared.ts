import {
  identityAuthorizationError,
  identityContextRequiredError,
  identityInvalidContextError,
} from "../../errors";
import {
  GLOBAL_IDENTITY_NAMESPACE,
  IDENTITY_SCOPE_SEPARATOR,
} from "../../async-contexts/identity.constants";
import type {
  IdentityContextValue,
  IdentityRequirementConfig,
} from "../../public-types";
import { Match } from "../../tools/check";

interface NormalizedIdentityRequirementConfig {
  tenant: true;
  user: boolean;
  roles: string[];
}

const identityRolesPattern = Match.ArrayOf(Match.NonEmptyString);

export function isIdentityRequirementConfig(
  value: unknown,
): value is IdentityRequirementConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);

  return (
    (candidate.tenant === undefined || candidate.tenant === true) &&
    (candidate.user === undefined || typeof candidate.user === "boolean") &&
    (candidate.roles === undefined ||
      Match.test(candidate.roles, identityRolesPattern)) &&
    keys.every((key) => key === "tenant" || key === "user" || key === "roles")
  );
}

export const identityRequirementPattern = Match.Optional(
  Match.Where((value: unknown): value is IdentityRequirementConfig =>
    isIdentityRequirementConfig(value),
  ),
);

function cloneRoles(
  roles: readonly string[] | undefined,
): string[] | undefined {
  return roles === undefined ? undefined : [...roles];
}

/**
 * Clones an identity requirement config while preserving its public shape.
 */
export function cloneIdentityRequirementConfig(
  config: IdentityRequirementConfig,
): IdentityRequirementConfig {
  return {
    ...(config.tenant === undefined ? {} : { tenant: true }),
    ...(config.user === undefined ? {} : { user: config.user }),
    ...(config.roles === undefined ? {} : { roles: cloneRoles(config.roles) }),
  };
}

/**
 * Applies runtime defaults for task identity gates.
 *
 * Mentioning a gate implies tenant identity.
 */
export function normalizeIdentityRequirementConfig(
  config: IdentityRequirementConfig | undefined,
): NormalizedIdentityRequirementConfig | undefined {
  if (config === undefined) {
    return undefined;
  }

  return {
    tenant: true,
    user: config.user ?? false,
    roles: cloneRoles(config.roles) ?? [],
  };
}

function validateRuntimeIdentityRoles(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Match.test(value, identityRolesPattern)) {
    throw identityInvalidContextError.new({
      reason:
        'Identity "roles" must be an array of non-empty strings when provided.',
    });
  }

  return [...value];
}

function validateIdentityField(
  fieldName: "tenantId" | "userId",
  value: unknown,
): string {
  if (!Match.test(value, Match.NonEmptyString)) {
    throw identityInvalidContextError.new({
      reason: `Identity "${fieldName}" must be a non-empty string when required by a task identity gate.`,
    });
  }

  const validated = value;

  if (fieldName === "tenantId" && validated === GLOBAL_IDENTITY_NAMESPACE) {
    throw identityInvalidContextError.new({
      reason: `Identity "tenantId" cannot be "${GLOBAL_IDENTITY_NAMESPACE}" because that value is reserved for the shared non-identity namespace.`,
    });
  }

  if (validated.includes(IDENTITY_SCOPE_SEPARATOR)) {
    throw identityInvalidContextError.new({
      reason: `Identity "${fieldName}" cannot contain "${IDENTITY_SCOPE_SEPARATOR}" because Runner uses it as an internal identity separator.`,
    });
  }

  return validated;
}

function resolveRequiredIdentity(
  config: NormalizedIdentityRequirementConfig,
  readIdentity: () => unknown,
): IdentityContextValue {
  const identity = readIdentity();

  if (!identity || typeof identity !== "object") {
    throw identityContextRequiredError.new();
  }

  const candidate = identity as IdentityContextValue;
  const tenantId = validateIdentityField("tenantId", candidate.tenantId);
  const userId = config.user
    ? validateIdentityField("userId", candidate.userId)
    : candidate.userId;

  return {
    ...candidate,
    tenantId,
    userId,
  };
}

/**
 * Enforces one task identity gate against the active runtime identity.
 */
export function assertIdentityRequirement(
  config: IdentityRequirementConfig | undefined,
  readIdentity?: () => unknown,
): IdentityContextValue | undefined {
  const normalized = normalizeIdentityRequirementConfig(config);
  if (!normalized) {
    return undefined;
  }

  const identity = resolveRequiredIdentity(
    normalized,
    readIdentity ?? (() => undefined),
  );
  const roles = validateRuntimeIdentityRoles(identity?.roles);

  if (
    normalized.roles.length > 0 &&
    !roles?.some((role) => normalized.roles.includes(role))
  ) {
    throw identityAuthorizationError.new({
      requiredRoles: normalized.roles,
    });
  }

  return {
    ...identity,
    ...(roles === undefined ? {} : { roles }),
  };
}
