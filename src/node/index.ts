// Node-only entry point
// Re-export the main API plus Node-only symbols
export * from "../index";

import { defineTag } from "../define";
export { nodeExposure } from "./exposure.resource";
