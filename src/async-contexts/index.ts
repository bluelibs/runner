import { executionAsyncContext } from "./execution.asyncContext";
import { identityAsyncContext } from "./identity.asyncContext";

/**
 * Framework-provided async-local accessors.
 *
 * `identity` is the built-in default async context contract for runtime
 * identity propagation. Apps can override which context identity-aware
 * framework features read by passing `run(..., { identity: yourAsyncContext })`.
 * `execution` exposes runtime execution tracing state backed by the
 * ExecutionContextStore.
 */
export const asyncContexts = Object.freeze({
  execution: executionAsyncContext,
  identity: identityAsyncContext,
});

/**
 * Shape carried by the built-in identity async context.
 */
export type { IIdentity, IdentityContextValue } from "../public-types";
