import { frameworkError } from "../../definers/builders/error";

/** Failure to safely coordinate a distributed resilience policy. */
export const resilienceError = frameworkError<{ message: string }>("resilience")
  .format(({ message }) => message)
  .build();
