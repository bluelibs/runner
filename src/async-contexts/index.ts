import { executionAsyncContext } from "./execution.asyncContext";
import { tenantAsyncContext } from "./tenant.asyncContext";

/**
 * Framework-provided async contexts for execution tracing and tenant propagation.
 */
export const asyncContexts = Object.freeze({
  execution: executionAsyncContext,
  tenant: tenantAsyncContext,
});

/**
 * Shape carried by the built-in tenant async context.
 */
export type { TenantContextValue } from "./tenant.asyncContext";
