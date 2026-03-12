import { asyncContexts } from "../../asyncContexts";
import {
  validateTenantContextValue,
  type TenantContextValue,
} from "../../async-contexts/tenant.asyncContext";
import { tenantContextRequiredError } from "../../errors";
import { Match } from "../../tools/check";

/**
 * Controls whether tenant-aware middleware partitions its internal state by the
 * active tenant.
 *
 * - `"auto"`: partition by tenant when tenant context exists, otherwise fall
 *   back to the shared non-tenant keyspace
 * - `"required"`: require tenant context and fail fast when it is missing
 * - `"off"`: disable tenant partitioning and use the shared cross-tenant
 *   keyspace
 */
export type TenantScopeMode = "auto" | "required" | "off";
export type TenantScopeConfig = TenantScopeMode;

export interface TenantScopedMiddlewareConfig {
  /**
   * Controls tenant partitioning for middleware-managed state.
   *
   * - `"auto"`: partition by tenant when tenant context exists, otherwise fall
   *   back to the shared non-tenant keyspace
   * - `"required"`: require tenant context and fail fast when it is missing
   * - `"off"`: disable tenant partitioning and use the shared cross-tenant
   *   keyspace
   *
   * Omit this option for the default `"auto"` behavior.
   */
  tenantScope?: TenantScopeConfig;
}

export const DEFAULT_TENANT_SCOPE = "auto";

function isTenantScopeMode(value: unknown): value is TenantScopeMode {
  return value === "auto" || value === "required" || value === "off";
}

export const tenantScopePattern = Match.Optional(
  Match.Where((value: unknown): value is TenantScopeConfig =>
    isTenantScopeMode(value),
  ),
);

export function getTenantScopeMode(
  tenantScope: TenantScopeConfig | undefined,
): TenantScopeMode {
  if (tenantScope === undefined) {
    return DEFAULT_TENANT_SCOPE;
  }

  return tenantScope;
}

export function resolveTenantContext(
  tenantScope: TenantScopeConfig | undefined,
  readTenant: () => unknown = () => asyncContexts.tenant.tryUse(),
): TenantContextValue | undefined {
  const mode = getTenantScopeMode(tenantScope);
  if (mode === "off") {
    return undefined;
  }

  const tenant = readTenant();
  if (!tenant) {
    if (mode === "required") {
      throw tenantContextRequiredError.new();
    }

    return undefined;
  }

  return validateTenantContextValue(tenant);
}

export function applyTenantScopeToKey(
  baseKey: string,
  tenantScope: TenantScopeConfig | undefined,
  readTenant?: () => unknown,
): string {
  const tenant = resolveTenantContext(tenantScope, readTenant);
  return tenant ? `${tenant.tenantId}:${baseKey}` : baseKey;
}

export function getTenantNamespace(
  tenantScope: TenantScopeConfig | undefined,
  readTenant?: () => unknown,
): string {
  const tenant = resolveTenantContext(tenantScope, readTenant);
  return tenant?.tenantId ?? "__global__";
}
