import type { Readable } from "stream";
import type { SerializerLike } from "../../serializer";
import type { ProtocolEnvelope } from "../../remote-lanes/http/protocol";
import {
  assertOkEnvelope,
  buildEventRequestBody,
  RemoteLaneTransportError,
} from "../../remote-lanes/http/protocol";
import type { IAsyncContext } from "../../types/asyncContext";
import type { IErrorHelper } from "../../types/error";
// Avoid `.node` bare import which triggers tsup native addon resolver
import { buildNodeManifest } from "../upload/manifest";
import { httpBaseUrlRequiredError } from "../../errors";
import { isReadable, hasNodeFile } from "./nodeFileDetection";
import {
  parseMaybeJsonResponse,
  postJson,
  postMultipart,
  postOctetStream,
  rethrowTyped,
} from "./http-smart-client.transport";

export interface HttpSmartClientAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface HttpSmartClientConfig {
  baseUrl: string; // ex: http://localhost:7070/__runner
  auth?: HttpSmartClientAuthConfig;
  timeoutMs?: number; // optional request timeout for JSON/multipart
  serializer: SerializerLike;
  onRequest?: (requestContext: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
  contexts?: Array<IAsyncContext<unknown>>;
  errorRegistry?: Map<string, IErrorHelper<any>>;
}

export interface HttpSmartClient {
  task<I = unknown, O = unknown>(
    id: string,
    input?: I,
    options?: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<O | Readable>;
  event<P = unknown>(
    id: string,
    payload?: P,
    options?: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<void>;
  eventWithResult?<P = unknown>(
    id: string,
    payload?: P,
    options?: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<P>;
}

/**
 * Creates a Node HTTP smart client that selects JSON, multipart, or raw stream transport per call.
 */
export function createHttpSmartClient(
  cfg: HttpSmartClientConfig,
): HttpSmartClient {
  const baseUrl = cfg.baseUrl.replace(/\/$/, "");
  if (!baseUrl) {
    httpBaseUrlRequiredError.throw({
      clientFactory: "createHttpSmartClient",
    });
  }
  const serializer = cfg.serializer;

  return {
    async task<I, O>(
      id: string,
      input?: I,
      options?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<O | Readable> {
      const url = `${baseUrl}/task/${encodeURIComponent(id)}`;

      // A) Duplex raw-body: input itself is a Node Readable
      if (isReadable(input)) {
        const { res } = await postOctetStream(
          cfg,
          url,
          input,
          options?.headers,
          options?.signal,
        );
        const maybe = await parseMaybeJsonResponse<ProtocolEnvelope<O>>(
          res,
          serializer,
        );
        if (isReadable(maybe)) return maybe;
        return assertOkEnvelope<O>(maybe as ProtocolEnvelope<O>, {
          fallbackMessage: "Remote lane task error",
        }) as O;
      }

      // B) Multipart: detect File sentinels with local Node sources
      if (hasNodeFile(input)) {
        const manifest = buildNodeManifest(input);
        const manifestText = serializer.stringify({
          input: manifest.input,
        });
        try {
          const { res } = await postMultipart(
            cfg,
            url,
            manifestText,
            manifest.files,
            options?.headers,
            options?.signal,
          );
          const maybe = await parseMaybeJsonResponse<ProtocolEnvelope<O>>(
            res,
            serializer,
          );
          if (isReadable(maybe)) return maybe; // server streamed back directly
          return assertOkEnvelope<O>(maybe as ProtocolEnvelope<O>, {
            fallbackMessage: "Remote lane task error",
          }) as O;
        } catch (error) {
          rethrowTyped(cfg.errorRegistry, error);
        }
      }

      // C) JSON fallback
      try {
        const r = await postJson<ProtocolEnvelope<O>>(
          cfg,
          url,
          { input },
          options?.headers,
          options?.signal,
        );
        return assertOkEnvelope<O>(r, {
          fallbackMessage: "Remote lane task error",
        });
      } catch (error) {
        rethrowTyped(cfg.errorRegistry, error);
      }
    },

    async event<P>(
      id: string,
      payload?: P,
      options?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<void> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      try {
        const r = await postJson<ProtocolEnvelope<void>>(
          cfg,
          url,
          buildEventRequestBody(payload),
          options?.headers,
          options?.signal,
        );
        assertOkEnvelope<void>(r, {
          fallbackMessage: "Remote lane event error",
        });
      } catch (error) {
        rethrowTyped(cfg.errorRegistry, error);
      }
    },

    async eventWithResult<P>(
      id: string,
      payload?: P,
      options?: { headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<P> {
      const url = `${baseUrl}/event/${encodeURIComponent(id)}`;
      try {
        const r = await postJson<ProtocolEnvelope<P>>(
          cfg,
          url,
          buildEventRequestBody(payload, { returnPayload: true }),
          options?.headers,
          options?.signal,
        );
        if (r && typeof r === "object" && r.ok && !("result" in r)) {
          throw new RemoteLaneTransportError(
            "INVALID_RESPONSE",
            "Remote lane event returnPayload requested but server did not include result. Upgrade the exposure server.",
          );
        }
        return assertOkEnvelope<P>(r, {
          fallbackMessage: "Remote lane event error",
        });
      } catch (error) {
        rethrowTyped(cfg.errorRegistry, error);
      }
    },
  };
}

export type { Readable };
