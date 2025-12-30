// Node-only entry point
// Re-export the main API plus Node-only symbols
export * from "../index";
import { globals as coreGlobals } from "../index";
import { run as coreRun } from "../run";
import type { RunResult } from "../models/RunResult";

export { nodeExposure } from "./exposure.resource";
export {
  hasExposureContext,
  useExposureContext,
} from "./exposure/requestContext";
export { createNodeFile } from "./files";
export type * from "./exposure/resourceTypes";
// Important: avoid importing a path that ends with `.node`
// as tsup's native-node-modules plugin treats it as a native addon.
// Point explicitly to the TS module to keep bundling happy.
export { createHttpSmartClient } from "./http-smart-client.model";
export type * from "./http-smart-client.model";
export { createHttpMixedClient } from "./http-mixed-client";
export type * from "./http-mixed-client";
export { readInputFileToBuffer, writeInputFileToPath } from "./inputFile.utils";
export * from "./durable";

import { httpSmartClientFactory } from "./resources/http-smart-client.factory.resource";
import { httpMixedClientFactory } from "./resources/http-mixed-client.factory.resource";

// Augmented Node globals: include Node-only factories under resources
export const globals = {
  ...coreGlobals,
  resources: {
    ...coreGlobals.resources,
    httpSmartClientFactory,
    httpMixedClientFactory,
  },
};

// Node run wrapper: auto-register Node-only factories for better DX
export async function run(root: any, config?: any): Promise<RunResult<any>> {
  const rt = await coreRun(root, config);
  const store = await rt.getResourceValue(coreGlobals.resources.store);
  // Make Node factories discoverable via DI without explicit registration
  store.storeGenericItem(httpSmartClientFactory);
  store.storeGenericItem(httpMixedClientFactory);
  // Eagerly initialize values so getResourceValue works immediately
  const serializer = (await rt.getResourceValue(
    coreGlobals.resources.serializer,
  )) as any;
  const errorRegistry = new Map<string, any>();
  for (const [id, helper] of store.errors) errorRegistry.set(id, helper);
  const contexts = Array.from(store.asyncContexts.values()) as any[];

  const smartEntry = store.resources.get(httpSmartClientFactory.id);
  if (smartEntry && !smartEntry.isInitialized) {
    smartEntry.value = (cfg: any) =>
      require("./http-smart-client.model").createHttpSmartClient({
        ...cfg,
        serializer,
        contexts,
      });
    smartEntry.isInitialized = true;
  }

  const mixedEntry = store.resources.get(httpMixedClientFactory.id);
  if (mixedEntry && !mixedEntry.isInitialized) {
    mixedEntry.value = (cfg: any) =>
      require("./http-mixed-client").createHttpMixedClient({
        ...cfg,
        serializer,
        contexts,
        errorRegistry,
      });
    mixedEntry.isInitialized = true;
  }
  return rt as RunResult<any>;
}
