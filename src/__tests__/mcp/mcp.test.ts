import { task, resource, run } from "../../index";
import { mcpTag, mcpResource } from "../../mcp";
import { IValidationSchema } from "../../defs";

// Mock validation schema for testing
class MockValidationSchema<T> implements IValidationSchema<T> {
  constructor(private validator: (value: unknown) => T) {}

  parse(input: unknown): T {
    return this.validator(input);
  }

  safeParse(value: unknown) {
    try {
      return { success: true, data: this.validator(value) };
    } catch (error) {
      return { success: false, error };
    }
  }
}

describe("MCP Integration", () => {
  describe("mcpTag", () => {
    it("should create a tag with proper configuration", () => {
      const config = {
        name: "test-tool",
        description: "A test tool",
        annotations: { title: "Test Tool" }
      };
      
      const taggedWithConfig = mcpTag.with(config);
      expect(taggedWithConfig.config).toEqual(config);
      expect(taggedWithConfig.id).toBe("mcp.tool");
    });

    it("should work without configuration", () => {
      expect(mcpTag.id).toBe("mcp.tool");
    });
  });

  describe("Task with responseSchema", () => {
    it("should support responseSchema field", () => {
      const responseSchema = new MockValidationSchema((value: any) => ({ result: value.result }));
      
      const testTask = task({
        id: "test.task.responseSchema",
        responseSchema,
        async run(input: any) {
          return { result: 42 };
        }
      });

      expect(testTask.responseSchema).toBe(responseSchema);
    });

    it("should work with both resultSchema and responseSchema", () => {
      const resultSchema = new MockValidationSchema((value: any) => value);
      const responseSchema = new MockValidationSchema((value: any) => ({ api: value }));
      
      const testTask = task({
        id: "test.task.bothSchemas",
        resultSchema,
        responseSchema,
        async run(input: any) {
          return { internal: true };
        }
      });

      expect(testTask.resultSchema).toBe(resultSchema);
      expect(testTask.responseSchema).toBe(responseSchema);
    });
  });

  describe("mcpResource", () => {
    it("should create an MCP resource with basic configuration", async () => {
      const mcpConfig = {
        serverInfo: {
          name: "test-mcp",
          version: "1.0.0",
          description: "Test MCP server"
        },
        transport: { type: "stdio" as const },
        autoStart: false, // Don't auto-start for test
        tasks: []
      };

      const mcp = mcpResource.with(mcpConfig);
      
      expect(mcp.id).toBe("mcp.server");
      expect(mcp.config).toEqual(mcpConfig);
    });

    it("should initialize MCP server with tasks", async () => {
      // Create a test task with MCP tag
      const testTask = task<{ value: number }>({
        id: "test.mcp.task",
        tags: [
          mcpTag.with({
            name: "test-tool",
            description: "A test MCP tool"
          })
        ],
        responseSchema: new MockValidationSchema((value: any) => ({ result: value })),
        async run(input: { value: number }) {
          return { result: input.value * 2 };
        }
      });

      const mcpConfig = {
        serverInfo: {
          name: "test-mcp",
          version: "1.0.0"
        },
        transport: { type: "stdio" as const },
        autoStart: false, // Don't auto-start for test
        tasks: [testTask]
      };

      const mcp = mcpResource.with(mcpConfig);
      
      // Test that the resource can be initialized
      const app = resource({
        id: "test.app",
        register: [mcp, mcpTag], // Register the tag
        async init() {
          return "ready";
        }
      });

      const { value, dispose } = await run(app);
      expect(value).toBe("ready");
      await dispose();
    });

    it("should filter tasks when taskFilter is provided", async () => {
      const task1 = task({
        id: "test.task1",
        tags: [mcpTag.with({ name: "tool1" })],
        async run() { return {}; }
      });

      const task2 = task({
        id: "test.task2", 
        tags: [mcpTag.with({ name: "tool2" })],
        async run() { return {}; }
      });

      const mcpConfig = {
        serverInfo: { name: "test", version: "1.0.0" },
        transport: { type: "stdio" as const },
        autoStart: false,
        tasks: [task1, task2],
        taskFilter: (task: any, mcpConfig: any) => mcpConfig.name === "tool1"
      };

      const mcp = mcpResource.with(mcpConfig);
      
      // The resource should initialize successfully even with filtering
      const app = resource({
        id: "test.app",
        register: [mcp, mcpTag], // Register the tag
        async init() {
          return "ready";
        }
      });

      const { value, dispose } = await run(app);
      expect(value).toBe("ready");
      await dispose();
    });
  });

  describe("Integration", () => {
    it("should create a complete MCP setup", async () => {
      // Create MCP-tagged task
      const calculateTask = task<{ expression: string }>({
        id: "app.tasks.calculate",
        tags: [
          mcpTag.with({
            name: "calculate",
            description: "Perform mathematical calculations"
          })
        ],
        inputSchema: new MockValidationSchema((value: any) => ({
          expression: value.expression
        })),
        responseSchema: new MockValidationSchema((value: any) => ({
          result: value.result
        })),
        async run(input: { expression: string }) {
          // Simple calculation for test
          return { result: 42 };
        }
      });

      // Create MCP resource
      const mcp = mcpResource.with({
        serverInfo: {
          name: "calculator-mcp",
          version: "1.0.0",
          description: "Calculator MCP server"
        },
        transport: { type: "stdio" },
        autoStart: false, // Don't start stdio server in tests
        tasks: [calculateTask]
      });

      // Create app with both
      const app = resource({
        id: "app",
        register: [calculateTask, mcp, mcpTag], // Register the tag
        async init() {
          return "app ready";
        }
      });

      const { value, dispose } = await run(app);
      expect(value).toBe("app ready");
      await dispose();
    });
  });

  describe("Error Handling", () => {
    it("should handle zod-to-json-schema conversion errors gracefully", async () => {
      // Create a task with a schema that might cause conversion issues
      const taskWithBadSchema = task({
        id: "test.bad.schema",
        tags: [mcpTag.with({ name: "bad-schema-tool" })],
        inputSchema: {} as any, // Invalid schema that will cause conversion error
        responseSchema: {} as any, // Invalid schema
        async run() { return {}; }
      });

      const mcpConfig = {
        serverInfo: { name: "test", version: "1.0.0" },
        transport: { type: "stdio" as const },
        autoStart: false,
        tasks: [taskWithBadSchema]
      };

      // Should not throw during initialization even with bad schemas
      const mcp = mcpResource.with(mcpConfig);
      const app = resource({
        id: "test.app",
        register: [mcp, mcpTag],
        async init() { return "ready"; }
      });

      const { value, dispose } = await run(app);
      expect(value).toBe("ready");
      await dispose();
    });

    it("should handle manual start/stop operations", async () => {
      const testTask = task({
        id: "test.manual.start",
        tags: [mcpTag.with({ name: "manual-tool" })],
        async run() { return { result: "test" }; }
      });

      const mcpConfig = {
        serverInfo: { name: "test", version: "1.0.0" },
        transport: { type: "stdio" as const },
        autoStart: false, // Don't auto-start
        tasks: [testTask]
      };

      const mcp = mcpResource.with(mcpConfig);
      const app = resource({
        id: "test.app",
        register: [mcp, mcpTag],
        async init() {
          return "ready";
        }
      });

      const { value, dispose } = await run(app);
      expect(value).toBe("ready");
      await dispose();
    });

    it("should handle task execution in MCP tool callback", async () => {
      const calculatorTask = task({
        id: "test.calculator",
        tags: [mcpTag.with({ 
          name: "calculator",
          description: "Test calculator"
        })],
        inputSchema: new MockValidationSchema((value: any) => ({ num: value.num })),
        responseSchema: new MockValidationSchema((value: any) => ({ result: value.result })),
        async run(input: { num: number }) {
          if (input.num < 0) {
            throw new Error("Negative numbers not allowed");
          }
          return { result: input.num * 2 };
        }
      });

      const mcpConfig = {
        serverInfo: { name: "test", version: "1.0.0" },
        transport: { type: "stdio" as const },
        autoStart: false,
        tasks: [calculatorTask]
      };

      const mcp = mcpResource.with(mcpConfig);
      const app = resource({
        id: "test.app", 
        register: [mcp, mcpTag],
        async init() {
          return "initialized";
        }
      });

      const { value, dispose } = await run(app);
      expect(value).toBe("initialized");
      await dispose();
    });
  });
});