import type {
  ResolvedRpcLaneRetryPolicy,
  RpcLaneRequestOptions,
} from "../defs";
import {
  createCancellationErrorFromSignal,
  raceWithAbortSignal,
} from "../tools/abortSignals";
import {
  createRequestSignal,
  remoteLaneTimeoutError,
} from "./http/requestSignal";
import { RemoteLaneTransportError } from "./http/protocol";

/** Applies one overall cancellation budget while preserving per-attempt options. */
export async function callWithRpcLaneRetry<T>(
  policy: ResolvedRpcLaneRetryPolicy,
  options: RpcLaneRequestOptions | undefined,
  call: (options: RpcLaneRequestOptions | undefined) => Promise<T>,
): Promise<T> {
  if (policy.totalTimeoutMs === undefined) {
    return attemptRpcLaneCall(policy, options?.signal, () => call(options));
  }
  const request = createRequestSignal(options?.signal, policy.totalTimeoutMs);
  try {
    if (request.signal!.aborted)
      throw createCancellationErrorFromSignal(request.signal!);
    const pending = attemptRpcLaneCall(policy, request.signal, () =>
      call({ ...options, signal: request.signal }),
    );
    return await raceWithAbortSignal(pending, request.signal);
  } catch (error) {
    if (request.isTimedOut())
      throw remoteLaneTimeoutError(policy.totalTimeoutMs);
    throw error;
  } finally {
    request.cleanup();
  }
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
      const policyDelay =
        typeof policy.delayMs === "function"
          ? policy.delayMs(retries, error)
          : policy.delayMs;
      const delay = Math.max(
        policyDelay,
        error instanceof RemoteLaneTransportError
          ? (error.retryAfterMs ?? 0)
          : 0,
      );
      if (delay > 0) {
        await delayWithAbort(delay, signal);
      }
      // A policy callback or the completed delay may have cancelled the call.
      if (signal?.aborted) {
        throw createCancellationErrorFromSignal(signal);
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
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      activeSignal.removeEventListener("abort", onAbort);
    };
    const settle = (complete: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      complete();
    };
    function onAbort() {
      settle(() => reject(createCancellationErrorFromSignal(activeSignal)));
    }
    const timer = setTimeout(() => settle(resolve), ms);
    activeSignal.addEventListener("abort", onAbort, { once: true });
    if (activeSignal.aborted) {
      onAbort();
    }
  });
}
