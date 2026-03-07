import { defineFrameworkResource } from "../../definers/frameworkDefinition";
import type { MixedHttpClient } from "./http-mixed-client";

export interface HttpMixedClientFactoryConfig {
  baseUrl: string;
  auth?: { header?: string; token: string };
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
}

export type HttpMixedClientFactory = (
  config: HttpMixedClientFactoryConfig,
) => MixedHttpClient;

export const httpMixedClientFactory = defineFrameworkResource<
  void,
  Promise<HttpMixedClientFactory>
>({
  id: "runner.node.httpMixedClientFactory",
  meta: {
    title: "HTTP Mixed Client Factory (Node)",
    description:
      "Factory placeholder for Node Mixed HTTP clients. Value is supplied at runtime by the Node run() wrapper to auto-inject serializer, error registry, and async contexts.",
  },
});

export type { MixedHttpClient };
