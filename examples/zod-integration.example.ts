// Example of how to use Zod with the generic validation interface
// This file is not part of the core framework but shows integration

// First install zod: npm install zod
// Then use it like this:

import { z } from "zod";
import {
  task as defineTask,
  resource as defineResource,
  event as defineEvent,
  taskMiddleware as defineMiddleware,
} from "@bluelibs/runner";
import type { IValidationSchema } from "@bluelibs/runner";

// Zod schemas already implement IValidationSchema<T>!
// The .parse() method is compatible with our interface

const UserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
});

const createUserTask = defineTask({
  id: "task.createUserWithZod",
  inputSchema: UserSchema, // Works directly!
  run: async (userData) => {
    // userData is properly typed and validated
    return { id: "user-123", ...userData };
  },
});

const DatabaseConfigSchema = z.object({
  host: z.string(),
  port: z.number().min(1).max(65535),
  ssl: z.boolean().default(false),
});

const databaseResource = defineResource({
  id: "resource.databaseWithZod",
  configSchema: DatabaseConfigSchema, // Works directly!
  init: async (config) => {
    // config is properly typed with defaults applied
    return {
      connect: () =>
        `Connected to ${config.host}:${config.port} (SSL: ${config.ssl})`,
    };
  },
});

const EventPayloadSchema = z.object({
  userId: z.string(),
  action: z.enum(["created", "updated", "deleted"]),
});

const userActionEvent = defineEvent({
  id: "event.userActionWithZod",
  payloadSchema: EventPayloadSchema, // Works directly!
});

const TimingConfigSchema = z.object({
  timeout: z.number().positive(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const timingMiddleware = defineMiddleware({
  id: "middleware.timingWithZod",
  configSchema: TimingConfigSchema, // Works directly!
  run: async ({ next }, _, config) => {
    const start = Date.now();
    try {
      const result = await next();
      const duration = Date.now() - start;
      if (config.logLevel === "debug") {
        console.log(`Operation completed in ${duration}ms`);
      }
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.log(`Operation failed after ${duration}ms`);
      throw error;
    }
  },
});

// Usage examples:

// Zod also works with transformations
const StringToNumberSchema = z.string().transform((val) => parseInt(val, 10));

const mathTask = defineTask({
  id: "task.mathWithZodTransform",
  inputSchema: StringToNumberSchema,
  run: async (input: number) => {
    // input is transformed to number
    return input * 2;
  },
});

// And with custom validation libraries that implement IValidationSchema
class CustomValidator<T> implements IValidationSchema<T> {
  constructor(private validator: (input: unknown) => T) {}

  parse(input: unknown): T {
    return this.validator(input);
  }
}

const customSchema = new CustomValidator<{ value: string }>(
  (input: unknown) => {
    if (typeof input === "object" && input !== null && "value" in input) {
      return input as { value: string };
    }
    throw new Error("Invalid input");
  },
);

const customTask = defineTask({
  id: "task.customValidation",
  inputSchema: customSchema,
  run: async (input) => {
    return `Received: ${input.value}`;
  },
});

export {
  createUserTask,
  databaseResource,
  userActionEvent,
  timingMiddleware,
  mathTask,
  customTask,
};
