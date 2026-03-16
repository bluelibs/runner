import {
  defineTask,
  defineResource,
  defineEvent,
  defineHook,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";
import { IValidationSchema } from "../../defs";
import { genericError, matchError } from "../../errors";
import { Match } from "../../tools/check";

// Simple mock validation schemas for testing the interface
class MockValidationSchema<T> implements IValidationSchema<T> {
  constructor(
    private validator: (input: unknown) => T,
    private errorMessage?: string,
  ) {}

  parse(input: unknown): T {
    try {
      return this.validator(input);
    } catch (error) {
      throw genericError.new({
        message: this.errorMessage || "Validation failed",
      });
    }
  }
}

// Helper functions to create mock schemas similar to Zod
const mockSchema = {
  object: <T extends Record<string, any>>(
    shape: Record<keyof T, string>,
  ): IValidationSchema<T> => {
    return new MockValidationSchema((input: unknown) => {
      if (typeof input !== "object" || input === null) {
        throw genericError.new({ message: "Expected object" });
      }
      const obj = input as Record<string, unknown>;
      for (const [key, expectedType] of Object.entries(shape)) {
        if (expectedType === "string" && typeof obj[key] !== "string") {
          throw genericError.new({ message: `${key} must be string` });
        }
        if (expectedType === "number" && typeof obj[key] !== "number") {
          throw genericError.new({ message: `${key} must be number` });
        }
        if (expectedType === "boolean" && typeof obj[key] !== "boolean") {
          throw genericError.new({ message: `${key} must be boolean` });
        }
      }
      return obj as T;
    });
  },

  string: (): IValidationSchema<string> => {
    return new MockValidationSchema((input: unknown) => {
      if (typeof input !== "string") {
        throw genericError.new({ message: "Expected string" });
      }
      return input;
    });
  },

  number: (): IValidationSchema<number> => {
    return new MockValidationSchema((input: unknown) => {
      if (typeof input !== "number") {
        throw genericError.new({ message: "Expected number" });
      }
      return input;
    });
  },

  boolean: (): IValidationSchema<boolean> => {
    return new MockValidationSchema((input: unknown) => {
      if (typeof input !== "boolean") {
        throw genericError.new({ message: "Expected boolean" });
      }
      return input;
    });
  },

  transform: <T, U>(
    schema: IValidationSchema<T>,
    transformer: (value: T) => U,
  ): IValidationSchema<U> => {
    return new MockValidationSchema((input: unknown) => {
      const validated = schema.parse(input);
      return transformer(validated);
    });
  },

  withDefaults: <T>(defaultValue: T): IValidationSchema<T> => {
    return new MockValidationSchema((input: unknown) => {
      return input === undefined ? defaultValue : (input as T);
    });
  },
};

describe("Generic Validation Interface", () => {
  describe("Native Match boundary propagation", () => {
    it("surfaces MatchError for task input schemas", async () => {
      const task = defineTask({
        id: "task-match-input",
        inputSchema: Match.compile({ age: Match.Integer }),
        run: async () => "ok",
      });

      const app = defineResource({
        id: "app",
        register: [task],
        dependencies: { task },
        init: async (_, { task }) => {
          await task({ age: "bad" } as any);
        },
      });

      await expect(run(app)).rejects.toMatchObject({ id: matchError.id });
    });

    it("surfaces MatchError for task result schemas", async () => {
      const task = defineTask({
        id: "task-match-result",
        resultSchema: Match.compile({ ok: Boolean }) as any,
        run: async () => ({ nope: true }) as any,
      });

      const app = defineResource({
        id: "app",
        register: [task],
        dependencies: { task },
        init: async (_, { task }) => {
          await task(undefined);
        },
      });

      await expect(run(app)).rejects.toMatchObject({ id: matchError.id });
    });

    it("surfaces MatchError for resource config validation", () => {
      const resource = defineResource({
        id: "resource-match-config",
        configSchema: Match.compile({ port: Match.Integer }),
        init: async () => "ok",
      });

      expect(() => resource.with({ port: "bad" } as any)).toThrow(
        expect.objectContaining({ id: matchError.id }),
      );
    });

    it("surfaces MatchError for event payload validation", async () => {
      const event = defineEvent({
        id: "event-match-payload",
        payloadSchema: Match.compile({ message: String }),
      });
      const hook = defineHook({
        id: "event-match-payload-hook",
        on: event,
        run: async () => undefined,
      });

      const app = defineResource({
        id: "app",
        register: [event, hook],
        dependencies: { event },
        init: async (_, { event }) => {
          await event({ message: 42 } as any);
        },
      });

      await expect(run(app)).rejects.toMatchObject({ id: matchError.id });
    });

    it("surfaces MatchError for middleware config validation", () => {
      const middleware = defineTaskMiddleware({
        id: "middleware-match-config",
        configSchema: Match.compile({ timeout: Match.Integer }),
        run: async ({ next }) => next(),
      });

      expect(() => middleware.with({ timeout: "bad" } as any)).toThrow(
        expect.objectContaining({ id: matchError.id }),
      );
    });
  });

  describe("Task Input Validation", () => {
    it("should validate task input successfully with valid data", async () => {
      const userSchema = mockSchema.object<{
        name: string;
        age: number;
      }>({
        name: "string",
        age: "number",
      });

      const createUserTask = defineTask({
        id: "task-createUser",
        inputSchema: userSchema,
        run: async (input) => {
          return `Created user ${(input as { name: string }).name}`;
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
          });
          expect(result).toBe("Created user John Doe");
          return result;
        },
      });

      await run(app);
    });

    it("should throw validation error for invalid task input", async () => {
      const userSchema = new MockValidationSchema((input: unknown) => {
        if (typeof input !== "object" || input === null) {
          throw genericError.new({ message: "Expected object" });
        }
        const obj = input as Record<string, unknown>;
        if (typeof obj.name !== "string") {
          throw genericError.new({ message: "name must be string" });
        }
        if (typeof obj.age !== "number" || obj.age < 0) {
          throw genericError.new({ message: "age must be positive number" });
        }
        return obj;
      });

      const createUserTask = defineTask({
        id: "task-createUser-invalid",
        inputSchema: userSchema,
        run: async (input) => {
          return `Created user ${(input as { name: string }).name}`;
        },
      });

      const app = defineResource({
        id: "app",
        register: [createUserTask],
        dependencies: { createUserTask },
        init: async (_, { createUserTask }) => {
          await createUserTask({
            name: "John Doe",
            age: -5, // Invalid: negative age
          });
        },
      });

      await expect(run(app)).rejects.toThrow(/Task input validation failed/);
    });

    it("should transform input data when schema supports it", async () => {
      const stringToNumberSchema = mockSchema.transform(
        mockSchema.string(),
        (val: string) => parseInt(val, 10),
      );

      const mathTask = defineTask({
        id: "task-math",
        inputSchema: stringToNumberSchema,
        run: async (input: number) => {
          expect(typeof input).toBe("number");
          return input * 2;
        },
      });

      const app = defineResource({
        id: "app",
        register: [mathTask],
        dependencies: { mathTask },
        init: async (_, { mathTask }) => {
          const result = await mathTask("42" as any); // String input should be transformed to number
          expect(result).toBe(84);
          return result;
        },
      });

      await run(app);
    });
  });

  describe("Resource Config Validation", () => {
    it("should validate resource config when .with() is called (fail fast)", async () => {
      const configSchema = new MockValidationSchema((input: unknown) => {
        if (typeof input !== "object" || input === null) {
          throw genericError.new({ message: "Expected object" });
        }
        const obj = input as Record<string, unknown>;
        if (typeof obj.host !== "string") {
          throw genericError.new({ message: "host must be string" });
        }
        if (typeof obj.port !== "number" || obj.port < 1 || obj.port > 65535) {
          throw genericError.new({
            message: "port must be number between 1-65535",
          });
        }
        return obj;
      });

      const databaseResource = defineResource({
        id: "resource-database",
        configSchema: configSchema,
        init: async (config) => {
          return {
            connect: () =>
              `Connected to ${(config as { host: string }).host}:${(config as { port: number }).port}`,
          };
        },
      });

      // This should throw immediately when .with() is called, not during init
      expect(() => {
        databaseResource.with({
          host: "localhost",
          port: 99999, // Invalid: port too high
        });
      }).toThrow(/Resource config validation failed/);
    });

    it("should work with valid resource config", async () => {
      const configSchema = mockSchema.object<{
        host: string;
        port: number;
      }>({
        host: "string",
        port: "number",
      });

      const databaseResource = defineResource({
        id: "resource-database-valid",
        configSchema: configSchema,
        init: async (config) => {
          return {
            connect: () =>
              `Connected to ${(config as { host: string }).host}:${(config as { port: number }).port}`,
          };
        },
      });

      const app = defineResource({
        id: "app",
        register: [
          databaseResource.with({
            host: "localhost",
            port: 5432,
          }),
        ],
        dependencies: { database: databaseResource },
        init: async (_, { database }) => {
          const result = database.connect();
          expect(result).toBe("Connected to localhost:5432");
          return result;
        },
      });

      await run(app);
    });
  });

  describe("Event Payload Validation", () => {
    it("should validate event payload when emitted", async () => {
      const payloadSchema = new MockValidationSchema((input: unknown) => {
        if (typeof input !== "object" || input === null) {
          throw genericError.new({ message: "Expected object" });
        }
        const obj = input as Record<string, unknown>;
        if (typeof obj.message !== "string") {
          throw genericError.new({ message: "message must be string" });
        }
        return obj;
      });

      const testEvent = defineEvent({
        id: "event-test",
        payloadSchema: payloadSchema,
      });

      let receivedMessage = "";
      const listenerTask = defineHook({
        id: "task-listener",
        on: testEvent,
        run: async (event) => {
          receivedMessage = (event.data as { message: string }).message;
        },
      });

      const app = defineResource({
        id: "app",
        register: [testEvent, listenerTask],
        dependencies: { testEvent },
        init: async (_, { testEvent }) => {
          // This should work with valid payload
          await testEvent({ message: "Hello World" });
          expect(receivedMessage).toBe("Hello World");

          // This should throw with invalid payload

          await expect(testEvent({ invalidField: 123 })).rejects.toThrow(
            /Event payload validation failed/,
          );
        },
      });

      await run(app);
    });
  });

  describe("Middleware Config Validation", () => {
    it("should validate middleware config when .with() is called (fail fast)", async () => {
      const configSchema = new MockValidationSchema((input: unknown) => {
        if (typeof input !== "object" || input === null) {
          throw genericError.new({ message: "Expected object" });
        }
        const obj = input as Record<string, unknown>;
        if (typeof obj.timeout !== "number" || obj.timeout <= 0) {
          throw genericError.new({
            message: "timeout must be positive number",
          });
        }
        return obj;
      });

      const timingMiddleware = defineTaskMiddleware({
        id: "middleware-timing",
        configSchema: configSchema,
        run: async ({ next }, _, _config) => {
          return next();
        },
      });

      // This should throw immediately when .with() is called
      expect(() => {
        timingMiddleware.with({
          timeout: -5, // Invalid: negative timeout
        });
      }).toThrow(/Middleware config validation failed/);
    });

    it("should work with valid middleware config", async () => {
      const configSchema = mockSchema.object<{
        timeout: number;
      }>({
        timeout: "number",
      });

      const timingMiddleware = defineTaskMiddleware({
        id: "middleware-timing-valid",
        configSchema: configSchema,
        run: async ({ next }, _, config) => {
          const start = Date.now();
          const result = await next();
          Date.now() - start;
          expect(typeof (config as { timeout: number }).timeout).toBe("number");
          return result;
        },
      });

      const testTask = defineTask({
        id: "task-test",
        middleware: [timingMiddleware.with({ timeout: 5000 })],
        run: async () => {
          return "success";
        },
      });

      const app = defineResource({
        id: "app",
        register: [timingMiddleware, testTask],
        dependencies: { testTask },
        init: async (_, { testTask }) => {
          const result = await testTask();
          expect(result).toBe("success");
          return result;
        },
      });

      await run(app);
    });
  });

  describe("No Validation (Backward Compatibility)", () => {
    it("should work without any validation schemas", async () => {
      const task = defineTask({
        id: "task-noValidation",
        run: async (input: any) => {
          return `Received: ${JSON.stringify(input)}`;
        },
      });

      const resource = defineResource({
        id: "resource-noValidation",
        init: async (config: any) => {
          return { config };
        },
      });

      const event = defineEvent<any>({
        id: "event-noValidation",
      });

      const middleware = defineTaskMiddleware({
        id: "middleware-noValidation",
        run: async ({ next }) => next(),
      });

      const app = defineResource({
        id: "app",
        register: [
          task,
          resource.with({ anything: "goes" }),
          event,
          middleware,
        ],
        dependencies: { task, resource, event },
        init: async (_, { task, resource, event }) => {
          const taskResult = await task({ any: "data" });
          expect(taskResult).toBe('Received: {"any":"data"}');

          expect(resource.config.anything).toBe("goes");

          await event({ any: "payload" }); // Should work without validation

          return "success";
        },
      });

      await run(app);
    });
  });
});
