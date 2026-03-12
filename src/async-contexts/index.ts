import { executionAsyncContext } from "./execution.asyncContext";
import { tenantAsyncContext } from "./tenant.asyncContext";

export const asyncContexts = Object.freeze({
  execution: executionAsyncContext,
  tenant: tenantAsyncContext,
});

export type { TenantContextValue } from "./tenant.asyncContext";
