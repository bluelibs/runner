import {
  defineTask,
  defineResource,
  defineEvent,
  defineHook,
  defineTaskMiddleware,
  defineResourceMiddleware,
} from "../../define";
import { run } from "../../run";
import { IValidationSchema } from "../../defs";

// Mock validation schema similar to the existing pattern
class MockValidationSchema<T> implements IValidationSchema<T> {
  constructor(private validator: (input: unknown) => T) {}

  parse(input: unknown): T {
    return this.validator(input);
  }
}

describe("Validation Edge Cases", () => {
  it("should handle non-Error thrown from task input validation", async () => {
    const taskSchema = new MockValidationSchema<string>((_input: unknown) => {
      // Throw a non-Error object to trigger the instanceof Error === false branch
      throw "Non-error string thrown";
    });

    const task = defineTask({
      id: "task.nonErrorValidation",
      inputSchema: taskSchema,
      run: async (_input: string) => "success",
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      init: async (_, { task }) => {
        await task("invalid");
      },
    });

    await expect(run(app)).rejects.toThrow();
    await expect(run(app)).rejects.toThrow(
      "Task input validation failed for task.nonErrorValidation: Non-error string thrown",
    );
  });

  it("should handle non-Error thrown from resource config validation", async () => {
    const configSchema = new MockValidationSchema<any>((_input: unknown) => {
      throw "Resource config error string";
    });

    const resource = defineResource({
      id: "resource.nonErrorValidation",
      configSchema: configSchema,
      init: async (_config: any) => "success",
    });

    expect(() => {
      resource.with({ invalid: "config" });
    }).toThrow();
    expect(() => {
      resource.with({ invalid: "config" });
    }).toThrow(
      "Resource config validation failed for resource.nonErrorValidation: Resource config error string",
    );
  });

  it("should handle non-Error thrown from middleware config validation", async () => {
    const configSchema = new MockValidationSchema<any>((_input: unknown) => {
      throw "Middleware config error string";
    });

    const middleware = defineTaskMiddleware({
      id: "middleware.nonErrorValidation",
      configSchema: configSchema,
      run: async ({ next }) => next(),
    });

    expect(() => {
      middleware.with({ invalid: "config" });
    }).toThrow();
    expect(() => {
      middleware.with({ invalid: "config" });
    }).toThrow(
      "Middleware config validation failed for middleware.nonErrorValidation: Middleware config error string",
    );
  });

  it("should handle non-Error thrown from resource middleware config validation", async () => {
    const configSchema = new MockValidationSchema<any>((_input: unknown) => {
      throw "Resource middleware config error string";
    });

    const middleware = defineResourceMiddleware({
      id: "resource.middleware.nonErrorValidation",
      configSchema: configSchema,
      run: async ({ next }) => next(),
    });

    expect(() => {
      middleware.with({ invalid: "config" });
    }).toThrow(
      "Middleware config validation failed for resource.middleware.nonErrorValidation: Resource middleware config error string",
    );
  });

  it("should handle non-Error thrown from event payload validation", async () => {
    const payloadSchema = new MockValidationSchema<any>((_input: unknown) => {
      throw "Event payload error string";
    });

    const event = defineEvent({
      id: "event.nonErrorValidation",
      payloadSchema: payloadSchema,
    });

    const listenerTask = defineHook({
      id: "task.listener",
      on: event,
      run: async (_event) => {
        // This won't be called because validation will fail
      },
    });

    const app = defineResource({
      id: "app",
      register: [event, listenerTask],
      dependencies: { event },
      init: async (_, { event }) => {
        await event({ invalid: "payload" });
      },
    });

    await expect(run(app)).rejects.toThrow();
    await expect(run(app)).rejects.toThrow(
      "Event payload validation failed for event.nonErrorValidation: Event payload error string",
    );
  });
});
