import {
  assertOkEnvelope,
  buildEventRequestBody,
  type ProtocolEnvelope,
  RemoteLaneTransportError,
} from "./remote-lanes/http/protocol";
import type { SerializerLike } from "./serializer";
import type {
  ExposureFetchConfig,
  ExposureFetchClient,
} from "./remote-lanes/http/types";
import { httpBaseUrlRequiredError, httpFetchUnavailableError } from "./errors";
import { buildAsyncContextHeader } from "./node/remote-lanes/asyncContextAllowlist";
import { postFetch } from "./remote-lanes/http/postFetch";
import { RUNNER_ASYNC_CONTEXT_HEADER } from "./remote-lanes/http/constants";
export { normalizeError } from "./tools/normalizeError";
export type {
  ExposureFetchAuthConfig,
  ExposureFetchConfig,
  ExposureFetchClient,
} from "./remote-lanes/http/types";

// normalizeError is re-exported from error-utils for public API

function postSerialized<T>(options: {
  fetch: typeof fetch;
  url: string;
  body: unknown;
  headers: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  serializer: SerializerLike;
  onRequest?: (context: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  contextHeaderText?: string;
}): Promise<T> {
  return postFetch<T>({
    ...options,
    body: () => options.serializer.stringify(options.body),
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...options.headers,
      ...(options.contextHeaderText
        ? { [RUNNER_ASYNC_CONTEXT_HEADER]: options.contextHeaderText }
        : {}),
    },
  });
}

/**
 * This functions communicates with the exposure server over HTTP.
 * It uses the remote-lanes HTTP policy strategy.
 *
 * @param cfg
 * @returns
 */
export function createExposureFetch(
  cfg: ExposureFetchConfig,
): ExposureFetchClient {
  const baseUrl = cfg?.baseUrl?.replace(/\/$/, "");
  if (!baseUrl) {
    httpBaseUrlRequiredError.throw({ clientFactory: "createExposureFetch" });
  }

  const headerName = (cfg?.auth?.header ?? "x-runner-token").toLowerCase();
  const buildHeaders = () => {
    const headers: Record<string, string> = {};
    if (cfg?.auth?.token) headers[headerName] = cfg.auth.token;
    return headers;
  };

  const fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch);
  if (typeof fetchImpl !== "function") {
    httpFetchUnavailableError.throw({ clientFactory: "createExposureFetch" });
  }

  const buildContextHeader = () => {
    if (!cfg.contexts || cfg.contexts.length === 0) {
      return undefined;
    }

    return buildAsyncContextHeader({
      allowList: undefined,
      registry: new Map(cfg.contexts.map((context) => [context.id, context])),
      serializer: cfg.serializer,
    });
  };

  return {
    async task<I, O>(
      id: string,
      input?: I,
      options?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<O> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<O> = await postSerialized({
        fetch: fetchImpl,
        url,
        body: { input },
        headers: {
          ...buildHeaders(),
          ...(options?.headers ?? {}),
        },
        signal: options?.signal,
        timeoutMs: cfg?.timeoutMs,
        serializer: cfg.serializer,
        onRequest: cfg?.onRequest,
        contextHeaderText: buildContextHeader(),
      });
      try {
        return assertOkEnvelope<O>(r, {
          fallbackMessage: "Remote lane task error",
        });
      } catch (e) {
        // Optionally rethrow typed errors if registry present
        const te = e as { id?: unknown; data?: unknown };
        if (cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
    async event<P>(
      id: string,
      payload?: P,
      options?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<void> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<void> = await postSerialized({
        fetch: fetchImpl,
        url,
        body: buildEventRequestBody(payload),
        headers: {
          ...buildHeaders(),
          ...(options?.headers ?? {}),
        },
        signal: options?.signal,
        timeoutMs: cfg?.timeoutMs,
        serializer: cfg.serializer,
        onRequest: cfg?.onRequest,
        contextHeaderText: buildContextHeader(),
      });
      try {
        assertOkEnvelope<void>(r, {
          fallbackMessage: "Remote lane event error",
        });
      } catch (e) {
        const te = e as { id?: unknown; data?: unknown };
        if (cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
    async eventWithResult<P>(
      id: string,
      payload?: P,
      options?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<P> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      const r: ProtocolEnvelope<P> = await postSerialized({
        fetch: fetchImpl,
        url,
        body: buildEventRequestBody(payload, { returnPayload: true }),
        headers: {
          ...buildHeaders(),
          ...(options?.headers ?? {}),
        },
        signal: options?.signal,
        timeoutMs: cfg?.timeoutMs,
        serializer: cfg.serializer,
        onRequest: cfg?.onRequest,
        contextHeaderText: buildContextHeader(),
      });
      if (r && typeof r === "object" && r.ok && !("result" in r)) {
        throw new RemoteLaneTransportError(
          "INVALID_RESPONSE",
          "Remote lane event returnPayload requested but server did not include result. Upgrade the exposure server.",
        );
      }
      try {
        return assertOkEnvelope<P>(r, {
          fallbackMessage: "Remote lane event error",
        });
      } catch (e) {
        const te = e as { id?: unknown; data?: unknown };
        if (cfg.errorRegistry && te.id && te.data) {
          const helper = cfg.errorRegistry.get(String(te.id));
          if (helper) helper.throw(te.data);
        }
        throw e;
      }
    },
  } satisfies ExposureFetchClient;
}
