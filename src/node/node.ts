// Node entry point
// Re-export the full public API so Node consumers get the same base surface.
import { resources as baseResources, tags as baseTags } from "../public";
import { registerRpcLaneHttpPresetsForNode } from "./rpc-lanes/registerRpcLaneHttpPresets";
import { durableSupportResource } from "./durable/resources/durable.resource";
import { durableWorkflowTag } from "./durable/tags/durableWorkflow.tag";
import { memoryDurableResource } from "./durable/resources/memoryDurableResource";
import { redisDurableResource } from "./durable/resources/redisDurableResource";
import { redisCacheProviderResource } from "./cache/redisCacheProvider.resource";

registerRpcLaneHttpPresetsForNode();

export const resources = Object.freeze({
  ...baseResources,
  durable: durableSupportResource,
  memoryWorkflow: memoryDurableResource,
  redisWorkflow: redisDurableResource,
  redisCacheProvider: redisCacheProviderResource,
});

export const tags = Object.freeze({
  ...baseTags,
  durableWorkflow: durableWorkflowTag,
});

export * from "../public";
export { createNodeFile, NodeInputFile } from "./files";
export type { NodeReadable } from "./files";
export { readInputFileToBuffer, writeInputFileToPath } from "./files";
// Important: avoid importing a path that ends with `.node`
// as tsup's native-node-modules plugin treats it as a native addon.
// Point explicitly to the TS module to keep bundling happy.
export { createHttpSmartClient, createHttpMixedClient } from "./http";
export type {
  HttpSmartClient,
  HttpSmartClientAuthConfig,
  HttpSmartClientConfig,
  MixedHttpClient,
  MixedHttpClientAuthConfig,
  MixedHttpClientConfig,
  Readable,
} from "./http";
export * from "./durable";
export * from "./cache";
export * from "./event-lanes";
export * from "./rpc-lanes";
