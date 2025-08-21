import { defineTag } from "../define";
import { IValidationSchema } from "../defs";

/**
 * Configuration for MCP (Model Context Protocol) tasks.
 * 
 * Tasks tagged with this will be automatically exposed as MCP tools.
 */
export interface IMcpConfig {
  /**
   * Human-readable name for the MCP tool.
   * If not provided, the task ID will be used.
   */
  name?: string;
  
  /**
   * Description of what the tool does.
   * This will be shown to AI models when they decide whether to use the tool.
   */
  description?: string;
  
  /**
   * Additional MCP-specific annotations.
   */
  annotations?: {
    /**
     * A human-readable title for the tool.
     */
    title?: string;
    
    /**
     * Tags to categorize the tool for better organization.
     */
    tags?: string[];
    
    /**
     * Additional metadata for the tool.
     */
    [key: string]: any;
  };
}

/**
 * Tag for marking tasks as MCP (Model Context Protocol) compatible.
 * 
 * Tasks with this tag will be automatically exposed as MCP tools
 * when an MCP resource is created and started.
 * 
 * @example
 * ```ts
 * const calculateTask = task({
 *   id: "app.tasks.calculate",
 *   tags: [
 *     mcpTag.with({
 *       name: "calculate",
 *       description: "Perform mathematical calculations"
 *     })
 *   ],
 *   inputSchema: z.object({ 
 *     expression: z.string().describe("Mathematical expression to evaluate")
 *   }),
 *   responseSchema: z.object({ result: z.number() }),
 *   run: async (input) => {
 *     const result = eval(input.expression); // Note: eval is unsafe, use a proper parser
 *     return { result };
 *   }
 * });
 * ```
 */
export const mcpTag = defineTag<IMcpConfig>({
  id: "mcp.tool",
  meta: {
    description: "Marks tasks as MCP (Model Context Protocol) compatible tools"
  }
});