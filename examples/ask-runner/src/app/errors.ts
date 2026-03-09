import { Match, r } from "@bluelibs/runner";

const errorDataSchema = Match.compile({
  message: Match.NonEmptyString,
});

export const invalidQueryError = r
  .error<{ message: string }>("askRunnerInvalidQuery")
  .httpCode(400)
  .dataSchema(errorDataSchema)
  .format((data) => data.message)
  .build();

export const dailyBudgetExceededError = r
  .error<{ message: string }>("askRunnerDailyBudgetExceeded")
  .httpCode(503)
  .dataSchema(errorDataSchema)
  .format((data) => data.message)
  .build();

export const rateLimitExceededError = r
  .error<{ message: string }>("askRunnerRateLimitExceeded")
  .httpCode(429)
  .dataSchema(errorDataSchema)
  .format((data) => data.message)
  .build();

export const unauthorizedAdminError = r
  .error<{ message: string }>("askRunnerUnauthorizedAdmin")
  .httpCode(401)
  .dataSchema(errorDataSchema)
  .format((data) => data.message)
  .build();

export const missingConfigError = r
  .error<{ message: string }>("askRunnerMissingConfig")
  .httpCode(500)
  .dataSchema(errorDataSchema)
  .format((data) => data.message)
  .build();
