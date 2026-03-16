import { createHttpMixedClient } from "../http/http-mixed-client";
import { createHttpSmartClient } from "../http/http-smart-client.model";
import {
  registerRpcLaneHttpClientPreset,
  RpcLaneHttpClientConfig,
} from "../../definers/builders/rpcLane";
import {
  createErrorRegistry,
  createForwardingRpcLaneCommunicator,
  resolveSerializer,
} from "../../definers/builders/rpcLane/http-client.utils";
import type { Store } from "../../models/Store";

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
      contexts: [],
      errorRegistry: createErrorRegistry(store),
    });

    return createForwardingRpcLaneCommunicator(client, {
      strictEventWithResult: true,
    });
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
      contexts: [],
      errorRegistry: createErrorRegistry(store),
    });

    return createForwardingRpcLaneCommunicator(client, {
      strictEventWithResult: true,
    });
  });
}
