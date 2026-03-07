import { frameworkError as error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";

// RPC lane ownership conflict (exclusive owner per task)
export const rpcLaneOwnershipConflictError = error<
  {
    taskId: string;
    currentOwnerId: string;
    attemptedOwnerId: string;
  } & DefaultErrorType
>("runner.errors.rpcLane.ownershipConflict")
  .format(
    ({ taskId, currentOwnerId, attemptedOwnerId }) =>
      `Task "${taskId}" is already routed by rpc-lanes resource "${currentOwnerId}". Resource "${attemptedOwnerId}" cannot route it again. Ensure each task is owned by a single rpc-lanes router.`,
  )
  .remediation(
    ({ taskId }) =>
      `Each task can only be routed by one rpc-lanes resource. Remove the duplicate routing registration for "${taskId}" or split the task into separate definitions with distinct ids.`,
  )
  .build();

// Task not registered in Store (internal invariant)
export const taskNotRegisteredError = error<
  { taskId: string } & DefaultErrorType
>("runner.errors.taskNotRegistered")
  .format(
    ({ taskId }) =>
      `Task "${taskId}" is not registered in the Store. This is an internal error; ensure the task is registered before execution.`,
  )
  .remediation(
    ({ taskId }) =>
      `Register the task "${taskId}" in a parent resource via .register([yourTask]) before calling run(). If this error persists, it may indicate an internal framework bug.`,
  )
  .build();
