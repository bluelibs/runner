import { phantomTaskNotRoutedError } from "../errors";

/**
 * Ensures a phantom task call is routed through a tunnel.
 *
 * Phantom tasks resolve to `undefined` when no tunnel matches. This helper turns
 * that into a hard failure with a typed error.
 */
export function assertTaskRouted<T>(value: T | undefined, taskId: string): T {
  if (value === undefined) {
    phantomTaskNotRoutedError.throw({ taskId });
  }
  return value;
}

