import { contextError } from "../errors";
import {
  getCurrentExecutionContext,
  provideExecutionContext,
  recordExecutionContext,
} from "../models/ExecutionContextStore";
import type {
  ExecutionContextAccessor,
  ExecutionContextProvideOptions,
  ExecutionRecordResult,
} from "../types/executionContext";

function provide<T>(fn: () => T): T;
function provide<T>(options: ExecutionContextProvideOptions, fn: () => T): T;
function provide<T>(
  first: ExecutionContextProvideOptions | (() => T),
  second?: () => T,
): T {
  if (typeof first === "function") {
    return provideExecutionContext(undefined, first);
  }

  return provideExecutionContext(first, second!);
}

function record<T>(fn: () => T): Promise<ExecutionRecordResult<Awaited<T>>>;
function record<T>(
  options: ExecutionContextProvideOptions,
  fn: () => T,
): Promise<ExecutionRecordResult<Awaited<T>>>;
function record<T>(
  first: ExecutionContextProvideOptions | (() => T),
  second?: () => T,
): Promise<ExecutionRecordResult<Awaited<T>>> {
  if (typeof first === "function") {
    return recordExecutionContext(undefined, first);
  }

  return recordExecutionContext(first, second!);
}

export const executionAsyncContext: ExecutionContextAccessor = Object.freeze({
  id: "asyncContexts.execution",
  use() {
    const current = getCurrentExecutionContext();
    if (!current) {
      contextError.throw({
        details:
          "Execution context is not available. Enable it via run(..., { executionContext: true }) or run inside an active task/event/hook execution.",
      });
    }

    return current!;
  },
  tryUse() {
    return getCurrentExecutionContext();
  },
  has() {
    return getCurrentExecutionContext() !== undefined;
  },
  provide,
  record,
});
