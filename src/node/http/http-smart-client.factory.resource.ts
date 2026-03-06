import { defineFrameworkResource } from "../../definers/frameworkDefinition";
import type { HttpSmartClient } from "./http-smart-client.model";

export interface HttpSmartClientFactoryConfig {
  baseUrl: string;
  auth?: { header?: string; token: string };
  timeoutMs?: number;
  onRequest?: (ctx: {
    url: string;
    headers: Record<string, string>;
  }) => void | Promise<void>;
}

export type HttpSmartClientFactory = (
  config: HttpSmartClientFactoryConfig,
) => HttpSmartClient;

export const httpSmartClientFactory = defineFrameworkResource<
  void,
  Promise<HttpSmartClientFactory>
>({
  id: "runner.node.httpSmartClientFactory",
  meta: {
    title: "HTTP Smart Client Factory (Node)",
    description:
      "Factory placeholder for Node Smart HTTP clients. Value is supplied at runtime by the Node run() wrapper to auto-inject serializer, error registry, and async contexts.",
  },
});

export type { HttpSmartClient };
