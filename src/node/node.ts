// Node-only entry point
// Export a focused Node surface (no blanket root re-exports).
export { run, globals } from "../public";

export { nodeExposure } from "./exposure";
export {
  hasExposureContext,
  useExposureContext,
} from "./exposure/requestContext";
export type * from "./exposure/resourceTypes";
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
