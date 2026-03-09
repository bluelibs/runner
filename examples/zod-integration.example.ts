// Example of how to use Zod with the generic validation interface
// This file is not part of the core framework but shows integration

// First install zod: npm install zod
// Then use it like this:

import { z } from "zod";
import { r } from "@bluelibs/runner";
import type { IValidationSchema } from "@bluelibs/runner";

// Zod schemas already implement IValidationSchema<T>!
// The .parse() method is compatible with our interface

const UserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
});

const createUserTask = r
  .task("createUserWithZod")
  .inputSchema(UserSchema)
  .run(async (userData) => {
    return { id: "user-123", ...userData };
  })
  .build();

const DatabaseConfigSchema = z.object({
  host: z.string(),
  port: z.number().min(1).max(65535),
  ssl: z.boolean().default(false),
});

const databaseResource = r
  .resource("databaseWithZod")
  .configSchema(DatabaseConfigSchema)
  .init(async (config) => {
    return {
      connect: () =>
        `Connected to ${config.host}:${config.port} (SSL: ${config.ssl})`,
    };
  })
  .build();

const EventPayloadSchema = z.object({
  userId: z.string(),
  action: z.enum(["created", "updated", "deleted"]),
});

const userActionEvent = r
  .event("userActionWithZod")
  .payloadSchema(EventPayloadSchema)
  .build();

const TimingConfigSchema = z.object({
  timeout: z.number().positive(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const timingMiddleware = r.middleware
  .task("timingWithZod")
  .configSchema(TimingConfigSchema)
  .run(async ({ next }, _, config) => {
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
  })
  .build();

// Usage examples:

// Zod also works with transformations
const StringToNumberSchema = z.string().transform((val) => parseInt(val, 10));

const mathTask = r
  .task("mathWithZodTransform")
  .inputSchema(StringToNumberSchema)
  .run(async (input: number) => {
    return input * 2;
  })
  .build();

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

const customTask = r
  .task("customValidation")
  .inputSchema(customSchema)
  .run(async (input) => {
    return `Received: ${input.value}`;
  })
  .build();

export {
  createUserTask,
  databaseResource,
  userActionEvent,
  timingMiddleware,
  mathTask,
  customTask,
};
