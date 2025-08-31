import { defineResource } from "../define";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { mcpTag, IMcpConfig } from "./mcp.tag";
import { ITask } from "../types/task";
import { IValidationSchema } from "../defs";
import { globalResources } from "../globals/globalResources";
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
   * Tasks to expose as MCP tools. If not provided, all tasks tagged with mcpTag will be automatically discovered.
   * @deprecated Use mcpTag on tasks instead of explicitly listing them here. This field will be removed in a future version.
   */
  tasks?: ITask[];
  
  /**
   * Optional filter function to determine which MCP-tagged tasks should be exposed.
   * If not provided, all provided tasks will be exposed.
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
 * MCP (Model Context Protocol) resource that exposes tasks as MCP tools.
 * 
 * This resource creates an MCP server and exposes provided tasks as tools.
 * 
 * @example
 * ```ts
 * // Define some MCP-compatible tasks
 * const calculateTask = task({
 *   id: "app.tasks.calculate",
 *   tags: [mcpTag.with({ name: "calculate", description: "Perform calculations" })],
 *   responseSchema: z.object({ result: z.number() }),
 *   run: async (input) => ({ result: 42 })
 * });
 * 
 * // Create MCP resource with auto-discovery
 * const mcp = mcpResource.with({
 *   serverInfo: {
 *     name: "my-app-mcp",
 *     version: "1.0.0",
 *     description: "MCP server for my application"
 *   },
 *   transport: { type: "stdio" }
 * });
 * 
 * run(mcp);
 * ```
 */
export const mcpResource = defineResource<
  IMcpResourceConfig,
  Promise<{
    server: McpServer;
    transport: StdioServerTransport;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  }>,
  {
    store: typeof globalResources.store;
  }
>({
  id: "mcp.server",
  
  dependencies: {
    store: globalResources.store,
  },
  
  async init(config: IMcpResourceConfig, { store }) {
    // Create MCP server
    const server = new McpServer(config.serverInfo);
    
    // Auto-discover tasks with mcpTag or use explicitly provided tasks (deprecated)
    let tasks: ITask[];
    if (config.tasks && config.tasks.length > 0) {
      // Use explicitly provided tasks (deprecated path)
      tasks = config.tasks;
    } else {
      // Auto-discover all tasks tagged with mcpTag
      tasks = store.getTasksWithTag(mcpTag.id);
    }
    
    // Register each task as an MCP tool
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
            // For now, return a placeholder response
            // TODO: In a real implementation, you'd execute the task properly
            const result = `Task ${task.id} would be executed with args: ${JSON.stringify(args)}`;
            
            // Return MCP-compatible result
            return {
              content: [
                {
                  type: "text" as const,
                  text: result
                }
              ],
              ...(outputSchema ? { 
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