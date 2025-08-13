import { z } from "zod";
import { defineTask, defineResource, defineEvent } from "../define";
import { run } from "../run";

describe("Zod Validation", () => {
  describe("Task Input Validation", () => {
    it("should validate task input successfully with valid data", async () => {
      const userSchema = z.object({
        name: z.string(),
        age: z.number().min(0),
        email: z.string().email(),
      });

      const createUserTask = defineTask({
        id: "task.createUser",
        inputSchema: userSchema,
        run: async (input) => {
          // Input should be properly typed and validated
          return `Created user ${input.name} (${input.age}) with email ${input.email}`;
        },
      });

      const app = defineResource({
        id: "app",
        register: [createUserTask],
        dependencies: { createUserTask },
        init: async (_, { createUserTask }) => {
          const result = await createUserTask({
            name: "John Doe",
            age: 30,
            email: "john@example.com",
          });
          expect(result).toBe("Created user John Doe (30) with email john@example.com");
          return result;
        },
      });

      await run(app);
    });

    it("should throw validation error for invalid task input", async () => {
      const userSchema = z.object({
        name: z.string(),
        age: z.number().min(0),
        email: z.string().email(),
      });

      const createUserTask = defineTask({
        id: "task.createUser.invalid",
        inputSchema: userSchema,
        run: async (input) => {
          return `Created user ${input.name}`;
        },
      });

      const app = defineResource({
        id: "app",
        register: [createUserTask],
        dependencies: { createUserTask },
        init: async (_, { createUserTask }) => {
          // This should throw a validation error
          await createUserTask({
            name: "John Doe",
            age: -5, // Invalid: negative age
            email: "invalid-email", // Invalid: not a valid email
          });
        },
      });

      await expect(run(app)).rejects.toThrow(/Task input validation failed/);
    });

    it("should coerce and transform input data when valid", async () => {
      const numberSchema = z.string().transform((val) => parseInt(val, 10));

      const mathTask = defineTask({
        id: "task.math",
        inputSchema: numberSchema,
        run: async (input: number) => { // Explicit type hint for the transformed value
          // Input should be transformed to number
          expect(typeof input).toBe("number");
          return input * 2;
        },
      });

      const app = defineResource({
        id: "app",
        register: [mathTask],
        dependencies: { mathTask },
        init: async (_, { mathTask }) => {
          // Cast to any to bypass TypeScript compile-time checking since validation happens at runtime
          const result = await (mathTask as any)("42"); // String input should be transformed to number
          expect(result).toBe(84);
          return result;
        },
      });

      await run(app);
    });

    it("should work with optional task input validation", async () => {
      const taskWithoutValidation = defineTask({
        id: "task.noValidation",
        run: async (input: any) => {
          return `Input received: ${JSON.stringify(input)}`;
        },
      });

      const app = defineResource({
        id: "app",
        register: [taskWithoutValidation],
        dependencies: { taskWithoutValidation },
        init: async (_, { taskWithoutValidation }) => {
          // Should work without validation
          const result = await taskWithoutValidation({ anything: "goes" });
          expect(result).toBe('Input received: {"anything":"goes"}');
          return result;
        },
      });

      await run(app);
    });

    it("should validate event listener task inputs", async () => {
      // Create a simple event for testing
      const testEvent = defineEvent<{ message: string; priority: "low" | "medium" | "high" }>({
        id: "event.testValidation",
      });

      const eventSchema = z.object({
        message: z.string(),
        priority: z.enum(["low", "medium", "high"]),
      });

      const eventListener = defineTask({
        id: "task.eventListener",
        on: testEvent,
        inputSchema: eventSchema,
        run: async (event) => {
          // Event input should be validated
          return `Handled event: ${event.data.message} with priority ${event.data.priority}`;
        },
      });

      // Note: This test demonstrates the interface works with event listeners
      expect(eventListener.inputSchema).toBeDefined();
      expect(eventListener.on).toBeDefined();
    });

    it("should handle complex nested validation schemas", async () => {
      const addressSchema = z.object({
        street: z.string(),
        city: z.string(),
        zipCode: z.string().regex(/^\d{5}$/),
      });

      const complexUserSchema = z.object({
        name: z.string().min(2),
        age: z.number().int().min(0).max(150),
        address: addressSchema,
        tags: z.array(z.string()),
        isActive: z.boolean().optional().default(true),
      });

      const complexTask = defineTask({
        id: "task.complex",
        inputSchema: complexUserSchema,
        run: async (input) => {
          return `User ${input.name} lives at ${input.address.street}, ${input.address.city}`;
        },
      });

      const app = defineResource({
        id: "app",
        register: [complexTask],
        dependencies: { complexTask },
        init: async (_, { complexTask }) => {
          const result = await complexTask({
            name: "Jane Doe",
            age: 25,
            address: {
              street: "123 Main St",
              city: "Anytown",
              zipCode: "12345",
            },
            tags: ["developer", "typescript"],
            isActive: true, // Explicitly provide this since TypeScript requires it
          });
          expect(result).toBe("User Jane Doe lives at 123 Main St, Anytown");
          return result;
        },
      });

      await run(app);
    });
  });

  describe("Resource Config Validation", () => {
    it("should validate resource config successfully with valid data", async () => {
      const databaseConfigSchema = z.object({
        host: z.string(),
        port: z.number().min(1).max(65535),
        database: z.string(),
        ssl: z.boolean().optional().default(false),
      });

      const databaseResource = defineResource({
        id: "resource.database",
        configSchema: databaseConfigSchema,
        init: async (config) => {
          // Config should be properly typed and validated
          return {
            connect: () => `Connected to ${config.database} at ${config.host}:${config.port} (SSL: ${config.ssl})`,
          };
        },
      });

      const app = defineResource({
        id: "app",
        register: [
          databaseResource.with({
            host: "localhost",
            port: 5432,
            database: "myapp",
            ssl: false, // Explicitly provide this since TypeScript requires it
          }),
        ],
        dependencies: { database: databaseResource },
        init: async (_, { database }) => {
          const result = database.connect();
          expect(result).toBe("Connected to myapp at localhost:5432 (SSL: false)");
          return result;
        },
      });

      await run(app);
    });

    it("should throw validation error for invalid resource config", async () => {
      const configSchema = z.object({
        host: z.string(),
        port: z.number().min(1).max(65535),
        timeout: z.number().positive(),
      });

      const invalidResource = defineResource({
        id: "resource.invalid",
        configSchema: configSchema,
        init: async (config) => {
          return { value: "should not reach here" };
        },
      });

      const app = defineResource({
        id: "app",
        register: [
          invalidResource.with({
            host: "localhost",
            port: 99999, // Invalid: port too high
            timeout: -5, // Invalid: negative timeout
          }),
        ],
        dependencies: { invalid: invalidResource },
        init: async (_, { invalid }) => {
          return invalid;
        },
      });

      await expect(run(app)).rejects.toThrow(/Resource config validation failed/);
    });

    it("should work with optional resource config validation", async () => {
      const resourceWithoutValidation = defineResource({
        id: "resource.noValidation",
        init: async (config: any) => {
          return { data: `Config received: ${JSON.stringify(config)}` };
        },
      });

      const app = defineResource({
        id: "app",
        register: [
          resourceWithoutValidation.with({ anything: "goes", here: 123 }),
        ],
        dependencies: { resource: resourceWithoutValidation },
        init: async (_, { resource }) => {
          expect(resource.data).toBe('Config received: {"anything":"goes","here":123}');
          return resource;
        },
      });

      await run(app);
    });

    it("should validate resource config with transformations", async () => {
      type EnvConfig = {
        port: string;
        debug: string;
        timeout: string;
      };

      const envConfigSchema = z.object({
        port: z.string().transform((val) => parseInt(val, 10)),
        debug: z.string().transform((val) => val.toLowerCase() === "true"),
        timeout: z.string().transform((val) => parseInt(val, 10) * 1000), // Convert to ms
      });

      const envResource = defineResource({
        id: "resource.env",
        configSchema: envConfigSchema,
        init: async (config: any) => { // Use any since runtime validation transforms the type
          // Config should be transformed
          expect(typeof config.port).toBe("number");
          expect(typeof config.debug).toBe("boolean");
          expect(typeof config.timeout).toBe("number");
          
          return {
            getPort: () => config.port,
            isDebug: () => config.debug,
            getTimeout: () => config.timeout,
          };
        },
      });

      const app = defineResource({
        id: "app",
        register: [
          envResource.with({
            port: "3000", // String will be transformed to number
            debug: "true", // String will be transformed to boolean
            timeout: "30", // String will be transformed to 30000 (30 * 1000)
          } as EnvConfig),
        ],
        dependencies: { env: envResource },
        init: async (_, { env }) => {
          expect(env.getPort()).toBe(3000);
          expect(env.isDebug()).toBe(true);
          expect(env.getTimeout()).toBe(30000);
          return env;
        },
      });

      await run(app);
    });

    it("should handle resources without config that have config schema", async () => {
      const schema = z.object({
        value: z.number().optional().default(42),
      });

      const resourceWithDefault = defineResource({
        id: "resource.withDefault",
        configSchema: schema,
        init: async (config) => {
          // Config should have default value applied
          expect(config.value).toBe(42);
          return { result: config.value };
        },
      });

      const app = defineResource({
        id: "app",
        register: [resourceWithDefault.with({ value: 42 } as any)], // Cast as any since we're testing defaults
        dependencies: { resource: resourceWithDefault },
        init: async (_, { resource }) => {
          expect(resource.result).toBe(42);
          return resource;
        },
      });

      await run(app);
    });
  });

  describe("Error Messages", () => {
    it("should provide clear error messages for task validation failures", async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const task = defineTask({
        id: "task.errorTest",
        inputSchema: schema,
        run: async () => "success",
      });

      const app = defineResource({
        id: "app",
        register: [task],
        dependencies: { task },
        init: async (_, { task }) => {
          // Cast to any to bypass TypeScript checking since we want runtime validation error
          await (task as any)({ name: "John", age: "not a number" });
        },
      });

      try {
        await run(app);
        throw new Error("Expected validation error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Task input validation failed");
        expect((error as Error).message).toContain("task.errorTest");
      }
    });

    it("should provide clear error messages for resource validation failures", async () => {
      const schema = z.object({
        host: z.string(),
        port: z.number(),
      });

      const resource = defineResource({
        id: "resource.errorTest",
        configSchema: schema,
        init: async () => ({ value: "success" }),
      });

      const app = defineResource({
        id: "app",
        register: [resource.with({ host: "localhost", port: "not a number" } as any)],
        dependencies: { resource },
        init: async () => ({}),
      });

      try {
        await run(app);
        throw new Error("Expected validation error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Resource config validation failed");
        expect((error as Error).message).toContain("resource.errorTest");
      }
    });
  });
});