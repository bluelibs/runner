import { linkAbortSignals } from "../../tools/abortSignals";
import { RemoteLaneTransportError } from "./protocol";

/** Owns one request's timeout and temporary caller cancellation listeners. */
export function createRequestSignal(signal?: AbortSignal, timeoutMs?: number) {
  const controller =
    timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
  const link = linkAbortSignals([signal, controller?.signal]);
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : undefined;
  return {
    signal: link.signal,
    isTimedOut: () => timedOut,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      link.cleanup();
    },
  };
}

/** Produces the same timeout identity for buffered HTTP request shapes. */
export function remoteLaneTimeoutError(
  timeoutMs?: number,
): RemoteLaneTransportError {
  return new RemoteLaneTransportError(
    "TIMEOUT",
    `Remote lane request timed out after ${timeoutMs}ms`,
    { timeoutMs },
  );
}
