import { executionAsyncContext } from "./execution.asyncContext";
import { tenantAsyncContext } from "./tenant.asyncContext";

/**
 * Framework-provided async-local accessors.
 *
 * `tenant` is the built-in async context contract for tenant propagation.
 * `execution` exposes runtime execution tracing state backed by the
 * ExecutionContextStore.
 */
export const asyncContexts = Object.freeze({
  execution: executionAsyncContext,
  tenant: tenantAsyncContext,
});

/**
 * Shape carried by the built-in tenant async context.
 */
export type { ITenant, TenantContextValue } from "../public-types";
