import type { SerializerLike } from "../../serializer";
import { RemoteLaneTransportError, toRequestRejectionError } from "./protocol";
import { createRequestSignal, remoteLaneTimeoutError } from "./requestSignal";
import { parseRetryAfterMs } from "./retryAfter";

/** Sends an encoded request with uniform timeout, cancellation, and HTTP failures. */
export async function postFetch<T = any>(options: {
  fetch: typeof fetch;
  url: string;
  body: () => BodyInit;
  headers: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  serializer: SerializerLike;
  onRequest?: (requestContext: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
}): Promise<T> {
  const {
    fetch: fetchFn,
    url,
    body,
    headers,
    signal,
    timeoutMs,
    serializer,
    onRequest,
  } = options;
  const signalLink = createRequestSignal(signal, timeoutMs);
  try {
    if (onRequest) await onRequest({ url, headers });
    // Encoding failures are caller errors, not failed network attempts.
    const requestBody = body();
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers,
        body: requestBody,
        signal: signalLink.signal,
        // Security: prevent automatic redirects from forwarding auth headers.
        redirect: "error",
      });
    } catch (error) {
      if (signalLink.isTimedOut()) {
        throw remoteLaneTimeoutError(timeoutMs);
      }
      // Pre-response failures (DNS, refused, reset) become retryable
      // NETWORK_ERRORs; caller aborts pass through untouched.
      throw toRequestRejectionError(error, signalLink.signal?.aborted ?? false);
    }

    let text: string;
    try {
      text = await res.text();
    } catch (error) {
      if (
        signalLink.isTimedOut() &&
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        throw remoteLaneTimeoutError(timeoutMs);
      }
      throw error;
    }
    const status =
      typeof (res as { status?: unknown }).status === "number"
        ? (res as { status: number }).status
        : 200;
    const statusText =
      typeof (res as { statusText?: unknown }).statusText === "string"
        ? (res as { statusText: string }).statusText
        : "";
    const ok =
      typeof (res as { ok?: unknown }).ok === "boolean"
        ? (res as { ok: boolean }).ok
        : status >= 200 && status < 300;
    const contentType =
      typeof (res as { headers?: { get?: (name: string) => string | null } })
        .headers?.get === "function"
        ? ((
            res as { headers: { get: (name: string) => string | null } }
          ).headers.get("content-type") ?? undefined)
        : undefined;

    const retryAfterMs = parseRetryAfterMs(
      res.headers?.get?.("retry-after") ?? undefined,
    );

    if (!text) {
      if (!ok) {
        throw new RemoteLaneTransportError(
          "HTTP_ERROR",
          statusText
            ? `Remote lane HTTP ${status} ${statusText}`
            : `Remote lane HTTP ${status}`,
          { statusCode: status, statusText, contentType },
          { httpCode: status, retryAfterMs },
        );
      }
      // The endpoint returned an empty 2xx body — no payload to parse.
      // Callers that expect void/undefined return are safe; typed return T requires the cast.
      return undefined as T;
    }

    try {
      const json = serializer.parse<T>(text);
      return json;
    } catch (error) {
      if (!ok) {
        throw new RemoteLaneTransportError(
          "HTTP_ERROR",
          statusText
            ? `Remote lane HTTP ${status} ${statusText}`
            : `Remote lane HTTP ${status}`,
          {
            statusCode: status,
            statusText,
            contentType,
            bodyPreview: text.slice(0, 512),
          },
          { httpCode: status, retryAfterMs },
        );
      }
      throw error;
    }
  } finally {
    signalLink.cleanup();
  }
}
