import type { Serializer } from "../resources/tunnel/serializer";
import { createExposureFetch } from "../../http-fetch-tunnel.resource";
import type { ExposureFetchClient } from "../../http-fetch-tunnel.resource";

export interface HttpClientAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface HttpCreateClientConfig {
  url: string; // ex: http://localhost:7070/__runner
  auth?: HttpClientAuthConfig;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  serializer: Serializer;
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
}

const http = Object.freeze({
  createClient(cfg: HttpCreateClientConfig): ExposureFetchClient {
    const { url, ...rest } = cfg;
    return createExposureFetch({ baseUrl: url, ...rest });
  },
});

export const tunnels = Object.freeze({
  http,
});

export type { ExposureFetchClient };
