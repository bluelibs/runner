import { defineResource } from "../../define";
import { createHttpClient, type HttpClient } from "../../http-client";
import type { HttpClientConfig } from "../../http-client";
import { serializer, store } from "../globalResources";
import type { IErrorHelper } from "../../types/error";
import type { IAsyncContext } from "../../types/asyncContext";

/**
 * Factory for creating HTTP clients with automatic injection of:
 * - serializer
 * - error registry (from Store)
 * - async contexts (from Store)
 *
 * Note: Node streaming clients are exposed via the Node entry only
 * (see createHttpSmartClient/createHttpMixedClient in `@bluelibs/runner/node`).
 * Keeping this universal factory browser-safe avoids dynamic imports.
 */

// Types for httpClientFactory
export interface HttpClientFactoryConfig {
  baseUrl: string;
  auth?: HttpClientConfig["auth"];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onRequest?: HttpClientConfig["onRequest"];
}

export type HttpClientFactory = (config: HttpClientFactoryConfig) => HttpClient;

export const httpClientFactory = defineResource({
  id: "globals.resources.httpClientFactory",
  meta: {
    title: "HTTP Client Factory",
    description:
      "Factory for creating HTTP clients with automatic injection of serializer, error registry, and async contexts from the store.",
  },
  // Use it as a function to avoid circular dependencies, and undefined
  dependencies: () => ({
    serializer: serializer,
    store: store,
  }),
  init: async (_, { serializer, store }) => {
    // Build error registry from store.errors
    const errorRegistry = new Map<string, IErrorHelper<any>>();
    for (const [id, helper] of store.errors) {
      errorRegistry.set(id, helper);
    }

    // Collect contexts from store.asyncContexts
    const contexts = Array.from(store.asyncContexts.values()) as unknown as IAsyncContext<any>[];

    const create: HttpClientFactory = (config: HttpClientFactoryConfig) =>
      createHttpClient({
        ...config,
        serializer,
        errorRegistry,
        contexts,
      });

    return create;
  },
});

export type { HttpClient };
