import type {
  IRpcLaneCommunicator,
  ResolvedRpcLaneRetryPolicy,
  RpcLaneRetryPolicy,
} from "../defs";
import { rpcLaneRetryPolicyInvalidInputError } from "../errors";
import { callWithRpcLaneRetry } from "./rpcRetryCall";
import { exponentialBackoffWithJitterMs } from "../tools/retryDelay";
import { RemoteLaneTransportError } from "./http/protocol";

/**
 * Default total attempts per lane-routed call, including the first attempt.
 */
export const DEFAULT_RPC_LANE_MAX_ATTEMPTS = 1;

/** Transport error codes retried without inspecting the HTTP status. */
const RETRYABLE_TRANSPORT_CODES = new Set([
  "TIMEOUT",
  "REQUEST_TIMEOUT",
  "NETWORK_ERROR",
]);

/**
 * HTTP statuses worth another attempt: timeouts, rate limits, and gateway
 * failures where the app plausibly never ran. Plain 500s are excluded: like
 * envelope domain errors, they mean the server executed and answered.
 */
const RETRYABLE_HTTP_CODES = new Set([408, 429, 502, 503, 504]);

/**
 * Default classifier for RPC-lane transport retries.
 *
 * Retries only failures without a definitive server answer: connection
 * failures, timeouts, and overload/gateway statuses. Typed domain errors
 * (which carry an error `id`), other 4xx/5xx statuses, malformed responses,
 * and caller aborts are never retried — those need domain knowledge or cannot
 * succeed by repeating the same call.
 *
 * Custom communicators participate by throwing `RemoteLaneTransportError`.
 *
 * @param error The failure thrown by the communicator.
 * @returns True when another attempt is worth trying.
 */
export function isRetryableRemoteLaneError(error: unknown): boolean {
  if (!(error instanceof RemoteLaneTransportError)) {
    return false;
  }
  if (error.id !== undefined) {
    return false;
  }
  if (RETRYABLE_TRANSPORT_CODES.has(error.code)) {
    return true;
  }
  if (error.code !== "HTTP_ERROR") {
    return false;
  }
  return (
    typeof error.httpCode === "number" &&
    RETRYABLE_HTTP_CODES.has(error.httpCode)
  );
}

/**
 * Applies retry defaults to a partial lane binding policy.
 *
 * @param policy The configured policy, if any.
 * @returns Policy with maxAttempts, delayMs, and retryIf resolved.
 */
export function resolveRpcLaneRetryPolicy(
  policy: RpcLaneRetryPolicy = {},
): ResolvedRpcLaneRetryPolicy {
  const violation = getRpcLaneRetryPolicyViolation(policy);
  if (violation) {
    rpcLaneRetryPolicyInvalidInputError.throw(violation);
  }

  return {
    maxAttempts: policy.maxAttempts ?? DEFAULT_RPC_LANE_MAX_ATTEMPTS,
    delayMs:
      policy.delayMs ?? ((attempt) => exponentialBackoffWithJitterMs(attempt)),
    retryIf: policy.retryIf ?? isRetryableRemoteLaneError,
    totalTimeoutMs: policy.totalTimeoutMs,
  };
}

/**
 * Returns the first semantically invalid numeric retry-policy field.
 *
 * Shape validation is handled by TypeScript and the topology config schema;
 * this guard covers numeric values whose JavaScript type is valid but whose
 * value would produce an empty or unbounded retry loop.
 *
 * @param policy The retry policy to validate.
 * @returns The invalid field and value, or undefined when valid.
 */
export function getRpcLaneRetryPolicyViolation(
  policy: RpcLaneRetryPolicy,
):
  | { field: "maxAttempts" | "delayMs" | "totalTimeoutMs"; value: string }
  | undefined {
  const { maxAttempts, delayMs } = policy;
  if (
    maxAttempts !== undefined &&
    (!Number.isInteger(maxAttempts) || maxAttempts < 1)
  ) {
    return { field: "maxAttempts", value: String(maxAttempts) };
  }

  if (
    typeof delayMs === "number" &&
    (!Number.isFinite(delayMs) || delayMs < 0)
  ) {
    return { field: "delayMs", value: String(delayMs) };
  }

  if (
    policy.totalTimeoutMs !== undefined &&
    (!Number.isInteger(policy.totalTimeoutMs) ||
      policy.totalTimeoutMs < 1 ||
      policy.totalTimeoutMs > 2_147_483_647)
  ) {
    return { field: "totalTimeoutMs", value: String(policy.totalTimeoutMs) };
  }

  return undefined;
}

/**
 * Wraps a lane communicator with transport-level retries.
 *
 * Only the methods implemented by the inner communicator are exposed, so
 * lane routing checks (`typeof communicator.eventWithResult === "function"`)
 * keep working on the wrapped instance. Retry delays honor the caller abort
 * signal: aborting rejects immediately instead of sleeping through the delay.
 * Inputs must be replayable; set maxAttempts to 1 for streams or other
 * single-use inputs.
 *
 * @param communicator The transport adapter to wrap.
 * @param policy Retry policy; omit for the default (one attempt; retries require explicit maxAttempts).
 * @returns Communicator with identical methods plus retry behavior.
 */
export function createRetryingRpcLaneCommunicator(
  communicator: IRpcLaneCommunicator,
  policy: RpcLaneRetryPolicy = {},
): IRpcLaneCommunicator {
  const resolved = resolveRpcLaneRetryPolicy(policy);
  const wrapped: IRpcLaneCommunicator = {};
  const task = communicator.task;
  if (task) {
    wrapped.task = (id, input, options) =>
      callWithRpcLaneRetry(resolved, options, (activeOptions) =>
        task.call(communicator, id, input, activeOptions),
      );
  }
  const event = communicator.event;
  if (event) {
    wrapped.event = (id, payload, options) =>
      callWithRpcLaneRetry(resolved, options, (activeOptions) =>
        event.call(communicator, id, payload, activeOptions),
      );
  }
  const eventWithResult = communicator.eventWithResult;
  if (eventWithResult) {
    wrapped.eventWithResult = (id, payload, options) =>
      callWithRpcLaneRetry(resolved, options, (activeOptions) =>
        eventWithResult.call(communicator, id, payload, activeOptions),
      );
  }
  return wrapped;
}
