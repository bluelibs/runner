/**
 * Model Context Protocol (MCP) integration for BlueLibs Runner.
 * 
 * This module provides easy integration with the Model Context Protocol,
 * allowing you to expose your runner tasks as MCP tools that can be used
 * by AI models and other MCP clients.
 * 
 * @example
 * ```ts
 * import { task, resource, run } from "@bluelibs/runner";
 * import { mcpTag, mcpResource } from "@bluelibs/runner/mcp";
 * import { z } from "zod";
 * 
 * // Create a task tagged for MCP
 * const calculateTask = task({
 *   id: "app.tasks.calculate",
 *   tags: [
 *     mcpTag.with({
 *       name: "calculate",
 *       description: "Perform mathematical calculations",
 *       responseSchema: z.object({ result: z.number() })
 *     })
 *   ],
 *   inputSchema: z.object({ 
 *     expression: z.string().describe("Mathematical expression to evaluate")
 *   }),
 *   run: async (input) => {
 *     // Implementation here
 *     return { result: 42 };
 *   }
 * });
 * 
 * // Create MCP server resource
 * const mcp = mcpResource.with({
 *   serverInfo: {
 *     name: "my-calculator-mcp",
 *     version: "1.0.0",
 *     description: "Calculator MCP server"
 *   },
 *   transport: { type: "http", port: 3001 }
 * });
 * 
 * // Run the application
 * const app = resource({
 *   id: "app",
 *   register: [calculateTask, mcp]
 * });
 * 
 * run(app);
 * ```
 */

export { mcpTag, type IMcpConfig } from "./mcp.tag";
export { mcpResource, type IMcpResourceConfig } from "./mcp.resource";