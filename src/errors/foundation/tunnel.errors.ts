import { error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";

// Tunnel ownership conflict (exclusive owner per task)
export const tunnelOwnershipConflictError = error<
  {
    taskId: string;
    currentOwnerId: string;
    attemptedOwnerId: string;
  } & DefaultErrorType
>("runner.errors.tunnelOwnershipConflict")
  .format(
    ({ taskId, currentOwnerId, attemptedOwnerId }) =>
      `Task "${taskId}" is already tunneled by resource "${currentOwnerId}". Resource "${attemptedOwnerId}" cannot tunnel it again. Ensure each task is owned by a single tunnel client.`,
  )
  .remediation(
    ({ taskId }) =>
      `Each task can only be tunneled by one client. Remove the duplicate tunnel registration for "${taskId}" or split the task into separate definitions with distinct ids.`,
  )
  .build();

// Phantom task executed without a matching tunnel route
export const phantomTaskNotRoutedError = error<
  { taskId: string } & DefaultErrorType
>("runner.errors.phantomTaskNotRouted")
  .format(
    ({ taskId }) =>
      `Phantom task "${taskId}" is not routed through any tunnel. Ensure a tunnel client selects this task id (or avoid calling the phantom task directly).`,
  )
  .remediation(
    ({ taskId }) =>
      `Configure a tunnel client resource to select "${taskId}" so it routes to a remote server. Phantom tasks cannot be executed locally - they only serve as local proxies for remote tasks.`,
  )
  .build();

// Task not registered in Store (internal invariant)
export const taskNotRegisteredError = error<
  { taskId: string } & DefaultErrorType
>("runner.errors.taskNotRegistered")
  .format(
    ({ taskId }) =>
      `Task "${taskId}" is not registered in the Store. This is an internal error-ensure the task is registered before execution.`,
  )
  .remediation(
    ({ taskId }) =>
      `Register the task "${taskId}" in a parent resource via .register([yourTask]) before calling run(). If this error persists, it may indicate an internal framework bug.`,
  )
  .build();
