import { defineResource } from "../define";
import { Store } from "../models/Store";
import { TaskRunner } from "../models/TaskRunner";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { mcpTag, IMcpConfig } from "./mcp.tag";
import { ITask } from "../types/task";
import { IValidationSchema } from "../defs";
import * as z from "zod";

/**
 * Configuration for the MCP resource.
 */
export interface IMcpResourceConfig {
  /**
   * Server information for the MCP server.
   */
  serverInfo: {
    name: string;
    version: string;
    description?: string;
  };
  
  /**
   * Transport configuration. Currently only stdio is supported.
   * - stdio: For local connections via stdin/stdout
   */
  transport: { type: "stdio" };
    
  /**
   * Whether to auto-start the server when the resource initializes.
   * Default: true
   */
  autoStart?: boolean;
  
  /**
   * Optional filter function to determine which MCP-tagged tasks should be exposed.
   * If not provided, all MCP-tagged tasks will be exposed.
   */
  taskFilter?: (task: ITask, mcpConfig: IMcpConfig) => boolean;
}

/**
 * Converts a validation schema to MCP-compatible JSON schema.
 * This is a simplified converter - you might want to use a more robust solution.
 */
function validationSchemaToJsonSchema(schema: IValidationSchema<any>): any {
  // If it's a Zod schema, use zod-to-json-schema
  if (schema && typeof (schema as any).safeParse === "function") {
    try {
      // Try to use zod-to-json-schema if available
      const zodToJsonSchema = require("zod-to-json-schema");
      return zodToJsonSchema.zodToJsonSchema(schema);
    } catch (error) {
      // Fallback to a basic object schema
      return {
        type: "object",
        properties: {},
        additionalProperties: true
      };
    }
  }
  
  // For other validation schemas, return a generic object schema
  return {
    type: "object",
    properties: {},
    additionalProperties: true
  };
}

/**
 * MCP (Model Context Protocol) resource that automatically exposes tagged tasks as MCP tools.
 * 
 * This resource scans for tasks tagged with mcpTag and registers them as tools
 * in an MCP server, making them available to AI models and other MCP clients.
 * 
 * @example
 * ```ts
 * const mcpResource = mcpResource.with({
 *   serverInfo: {
 *     name: "my-app-mcp",
 *     version: "1.0.0",
 *     description: "MCP server for my application"
 *   },
 *   transport: { type: "stdio" }
 * });
 * 
 * const app = resource({
 *   id: "app",
 *   register: [mcpResource, ...yourMcpTaggedTasks]
 * });
 * 
 * run(app);
 * ```
 */
export const mcpResource = defineResource<
  IMcpResourceConfig,
  { store: Store; taskRunner: TaskRunner },
  {
    server: McpServer;
    transport: StdioServerTransport;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  }
>({
  id: "mcp.server",
  dependencies: { 
    store: "globals.resources.store",
    taskRunner: "globals.resources.taskRunner"
  },
  
  async init(config, { store, taskRunner }) {
    // Create MCP server
    const server = new McpServer(config.serverInfo);
    
    // Get all tasks from the store
    const tasks = store.getTasksWithTag(mcpTag);
    
    // Register each MCP-tagged task as a tool
    for (const task of tasks) {
      const mcpConfig = mcpTag.extract(task);
      
      // Apply task filter if provided
      if (config.taskFilter && mcpConfig && !config.taskFilter(task, mcpConfig)) {
        continue;
      }
      
      // Determine tool name and description
      const toolName = mcpConfig?.name || task.id;
      const description = mcpConfig?.description || "Execute task: " + task.id;
      
      // Convert input schema to MCP format
      let inputSchema: any = {};
      if (task.inputSchema) {
        try {
          inputSchema = validationSchemaToJsonSchema(task.inputSchema);
        } catch (error) {
          console.warn("Failed to convert input schema for task " + task.id + ":", error);
        }
      }
      
      // Prepare output schema for MCP
      let outputSchema: any = undefined;
      const responseSchema = task.responseSchema || task.resultSchema;
      if (responseSchema) {
        try {
          outputSchema = validationSchemaToJsonSchema(responseSchema);
        } catch (error) {
          console.warn("Failed to convert response schema for task " + task.id + ":", error);
        }
      }
      
      // Register the tool
      server.tool(
        toolName,
        description,
        inputSchema,
        mcpConfig?.annotations || {},
        async (args: any) => {
          try {
            // Execute the task through the task runner
            const result = await taskRunner.run(task, args || {});
            
            // Return MCP-compatible result
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result, null, 2)
                }
              ],
              ...(outputSchema && result !== undefined ? { 
                structuredContent: { result } 
              } : {})
            };
          } catch (error) {
            // Return error as MCP result
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error executing task " + task.id + ": " + (error instanceof Error ? error.message : String(error))
                }
              ],
              isError: true
            };
          }
        }
      );
    }
    
    // Create transport - only stdio for now
    const transport = new StdioServerTransport();
    
    // Helper functions
    const start = async () => {
      await server.connect(transport);
    };
    
    const stop = async () => {
      await server.close();
    };
    
    // Auto-start if configured
    if (config.autoStart !== false) {
      await start();
    }
    
    return {
      server,
      transport,
      start,
      stop
    };
  },
  
  async dispose(value) {
    await value.stop();
  }
});