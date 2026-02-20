import { error } from "../../definers/builders/error";

export const cronConfigurationError = error<{ message: string }>(
  "runner.errors.cron.configuration",
)
  .format(({ message }) => message)
  .remediation(
    "Ensure your cron tag is configured with a valid expression and supported options.",
  )
  .build();

export const cronExecutionError = error<{
  taskId: string;
  expression: string;
  message: string;
}>("runner.errors.cron.execution")
  .format(
    ({ taskId, expression, message }) =>
      `Cron task \"${taskId}\" (${expression}) failed: ${message}`,
  )
  .remediation(
    ({ taskId }) =>
      `Inspect task \"${taskId}\" logs and dependencies. Fix the task failure or switch onError to \"continue\" to keep scheduling active.`,
  )
  .build();
