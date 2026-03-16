import { frameworkError as error } from "../../definers/builders/error";

export const cronExecutionError = error<{
  taskId: string;
  expression: string;
  message: string;
}>("cron-execution")
  .format(
    ({ taskId, expression, message }) =>
      `Cron task \"${taskId}\" (${expression}) failed: ${message}`,
  )
  .remediation(
    ({ taskId }) =>
      `Inspect task \"${taskId}\" logs and dependencies. Fix the task failure or switch onError to \"continue\" to keep scheduling active.`,
  )
  .build();
