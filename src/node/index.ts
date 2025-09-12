// Node-only entry point
// Re-export the main API plus Node-only symbols
export * from "../index";

import { defineTag } from "../define";
export { nodeExposure } from "./exposure.resource";
export { nodeHttpTunnel } from "./http-tunnel.resource";

// Example: a tag that exists only on the Node subpath
// Consumers can import this via `@bluelibs/runner/node`
export const nodeOnlyTag = defineTag<{ metadata?: Record<string, any> }>({
  id: "platform.node.only",
  meta: {
    title: "Node-Only",
    description: "A tag exported only in the Node build/subpath.",
  },
});
