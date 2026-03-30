import { r } from "@bluelibs/runner";

/**
 * Shared HTTP-facing auth failure used by the example's route bridge.
 * A single helper keeps the middleware semantics conventional and easy to copy.
 */
export const unauthorizedError = r
  .error<{ message: string }>("unauthorized")
  .httpCode(401)
  .format(({ message }) => message)
  .build();
