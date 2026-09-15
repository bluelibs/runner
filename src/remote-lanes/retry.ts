import type {
  IRpcLaneCommunicator,
  ResolvedRpcLaneRetryPolicy,
  RpcLaneRetryPolicy,
} from "../defs";
import { createCancellationErrorFromSignal } from "../tools/abortSignals";
import { exponentialBackoffWithJitterMs } from "../tools/retryDelay";
import { RemoteLaneTransportError } from "./http/protocol";

/**
 * Default total attempts per lane-routed call, including the first attempt.
 */
export const DEFAULT_RPC_LANE_MAX_ATTEMPTS = 3;

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
  return {
    maxAttempts: policy.maxAttempts ?? DEFAULT_RPC_LANE_MAX_ATTEMPTS,
    delayMs:
      policy.delayMs ?? ((attempt) => exponentialBackoffWithJitterMs(attempt)),
    retryIf: policy.retryIf ?? isRetryableRemoteLaneError,
  };
}

/**
 * Wraps a lane communicator with transport-level retries.
 *
 * Only the methods implemented by the inner communicator are exposed, so
 * lane routing checks (`typeof communicator.eventWithResult === "function"`)
 * keep working on the wrapped instance. Retry delays honor the caller abort
 * signal: aborting rejects immediately instead of sleeping through the delay.
 *
 * @param communicator The transport adapter to wrap.
 * @param policy Retry policy; omit for the default (3 attempts, backoff,
 * transport failures only).
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
      attemptRpcLaneCall(resolved, options?.signal, () =>
        task(id, input, options),
      );
  }
  const event = communicator.event;
  if (event) {
    wrapped.event = (id, payload, options) =>
      attemptRpcLaneCall(resolved, options?.signal, () =>
        event(id, payload, options),
      );
  }
  const eventWithResult = communicator.eventWithResult;
  if (eventWithResult) {
    wrapped.eventWithResult = (id, payload, options) =>
      attemptRpcLaneCall(resolved, options?.signal, () =>
        eventWithResult(id, payload, options),
      );
  }
  return wrapped;
}

async function attemptRpcLaneCall<T>(
  policy: ResolvedRpcLaneRetryPolicy,
  signal: AbortSignal | undefined,
  call: () => Promise<T>,
): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await call();
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (!policy.retryIf(error) || retries + 1 >= policy.maxAttempts) {
        throw error;
      }
      const delay =
        typeof policy.delayMs === "function"
          ? policy.delayMs(retries, error)
          : policy.delayMs;
      if (delay > 0) {
        await delayWithAbort(delay, signal);
      }
      retries += 1;
    }
  }
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  const activeSignal = signal;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      activeSignal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(createCancellationErrorFromSignal(activeSignal));
    }
    activeSignal.addEventListener("abort", onAbort, { once: true });
  });
}
