import { createHttpMixedClient } from "../http/http-mixed-client";
import { createHttpSmartClient } from "../http/http-smart-client.model";
import {
  registerRpcLaneHttpClientPreset,
  RpcLaneHttpClientConfig,
} from "../../definers/builders/rpcLane";
import type { Store } from "../../models/Store";
import type { IAsyncContext } from "../../types/asyncContext";
import type { IErrorHelper } from "../../types/error";
import { Serializer } from "../../serializer";

function createErrorRegistry(store?: Store): Map<string, IErrorHelper<any>> {
  const map = new Map<string, IErrorHelper<any>>();
  if (!store) return map;

  for (const [id, helper] of store.errors) {
    map.set(id, helper);
  }

  return map;
}

function createAsyncContexts(store?: Store): Array<IAsyncContext<unknown>> {
  if (!store) return [];
  return Array.from(store.asyncContexts.values()) as Array<
    IAsyncContext<unknown>
  >;
}

function resolveSerializer(dependencies: Record<string, unknown>) {
  return (
    (dependencies.serializer as Serializer | undefined) ?? new Serializer()
  );
}

function registerPreset(
  id: "mixed" | "smart",
  handler: (
    config: RpcLaneHttpClientConfig,
    dependencies: Record<string, unknown>,
  ) => {
    task: (taskId: string, input?: unknown) => Promise<unknown>;
    event: (eventId: string, payload?: unknown) => Promise<void>;
    eventWithResult: (eventId: string, payload?: unknown) => Promise<unknown>;
  },
) {
  registerRpcLaneHttpClientPreset(id, async (config, dependencies) =>
    handler(config, dependencies),
  );
}

export function registerRpcLaneHttpPresetsForNode() {
  registerPreset("mixed", (config, dependencies) => {
    const store = dependencies.store as Store | undefined;
    const serializer = resolveSerializer(dependencies);
    const client = createHttpMixedClient({
      baseUrl: config.baseUrl,
      auth: config.auth,
      timeoutMs: config.timeoutMs,
      fetchImpl: config.fetchImpl,
      onRequest: config.onRequest,
      serializer,
      forceSmart: config.forceSmart,
      contexts: createAsyncContexts(store),
      errorRegistry: createErrorRegistry(store),
    });

    return {
      task: async (taskId: string, input?: unknown) =>
        client.task(taskId, input),
      event: async (eventId: string, payload?: unknown) =>
        client.event(eventId, payload),
      eventWithResult: async (eventId: string, payload?: unknown) =>
        client.eventWithResult!(eventId, payload),
    };
  });

  registerPreset("smart", (config, dependencies) => {
    const store = dependencies.store as Store | undefined;
    const serializer = resolveSerializer(dependencies);
    const client = createHttpSmartClient({
      baseUrl: config.baseUrl,
      auth: config.auth,
      timeoutMs: config.timeoutMs,
      onRequest: config.onRequest,
      serializer,
      contexts: createAsyncContexts(store),
      errorRegistry: createErrorRegistry(store),
    });

    return {
      task: async (taskId: string, input?: unknown) =>
        client.task(taskId, input),
      event: async (eventId: string, payload?: unknown) =>
        client.event(eventId, payload),
      eventWithResult: async (eventId: string, payload?: unknown) =>
        client.eventWithResult!(eventId, payload),
    };
  });
}
