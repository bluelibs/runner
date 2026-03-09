// Example of how to use Runner's built-in check/Match validation.
// This file is not part of the core framework but shows the native approach.

import { Match, check, r } from "@bluelibs/runner";
import type { IValidationSchema } from "@bluelibs/runner/defs";

const UserSchema = Match.compile({
  name: Match.RegExp(/^.{2,}$/),
  email: Match.Email,
  age: Match.Integer,
});

const createUserTask = r
  .task("createUserWithMatch")
  .inputSchema(UserSchema)
  .run(async (userData) => {
    const safeUser = check(userData, UserSchema);

    return { id: "user-123", ...safeUser };
  })
  .build();

const DatabaseConfigSchema = Match.compile({
  host: Match.NonEmptyString,
  port: Match.Integer,
  ssl: Match.Optional(Boolean),
});

const databaseResource = r
  .resource("databaseWithMatch")
  .configSchema(DatabaseConfigSchema)
  .init(async (config) => {
    return {
      connect: () =>
        `Connected to ${config.host}:${config.port} (SSL: ${config.ssl ?? false})`,
    };
  })
  .build();

const EventPayloadSchema = Match.compile({
  userId: Match.NonEmptyString,
  action: Match.OneOf("created", "updated", "deleted"),
});

const userActionEvent = r
  .event("userActionWithMatch")
  .payloadSchema(EventPayloadSchema)
  .build();

const TimingConfigSchema = Match.compile({
  timeout: Match.PositiveInteger,
  logLevel: Match.Optional(Match.OneOf("debug", "info", "warn", "error")),
});

const timingMiddleware = r.middleware
  .task("timingWithMatch")
  .configSchema(TimingConfigSchema)
  .run(async ({ next }, _, config) => {
    const start = Date.now();

    try {
      const result = await next();
      const duration = Date.now() - start;

      if ((config.logLevel ?? "info") === "debug") {
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

class StringToNumberSchema implements IValidationSchema<number> {
  parse(input: unknown): number {
    const value = check(input, Match.NonEmptyString);
    const parsed = Number.parseInt(value, 10);

    if (Number.isNaN(parsed)) {
      throw new Error("Expected a numeric string");
    }

    return parsed;
  }

  toJSONSchema() {
    return {
      type: "string",
      pattern: "^-?\\d+$",
    };
  }
}

const mathTask = r
  .task("mathWithCustomParse")
  .inputSchema(new StringToNumberSchema())
  .run(async (input: number) => {
    return input * 2;
  })
  .build();

class CustomValidator<T> implements IValidationSchema<T> {
  constructor(private readonly validator: (input: unknown) => T) {}

  parse(input: unknown): T {
    return this.validator(input);
  }
}

const customSchema = new CustomValidator<{ value: string }>(
  (input: unknown) => {
    const parsed = check(input, Match.compile({ value: Match.NonEmptyString }));
    return parsed;
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
