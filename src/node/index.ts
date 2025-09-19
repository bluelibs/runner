// Node-only entry point
// Re-export the main API plus Node-only symbols
export * from "../index";
export { nodeExposure } from "./exposure.resource";
export { useExposureContext } from "./exposure/requestContext";
export { createNodeFile } from "./files";
// Important: avoid importing a path that ends with `.node`
// as tsup's native-node-modules plugin treats it as a native addon.
// Point explicitly to the TS module to keep bundling happy.
export { createHttpSmartClient } from "./http-smart-client.node.ts";
export { readInputFileToBuffer, writeInputFileToPath } from "./inputFile.utils";
