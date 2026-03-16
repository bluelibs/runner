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

  if (typeof second !== "function") {
    contextError.throw({
      details:
        "Execution context callback is required when calling asyncContexts.execution.provide(options, fn).",
    });
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

  if (typeof second !== "function") {
    contextError.throw({
      details:
        "Execution context callback is required when calling asyncContexts.execution.record(options, fn).",
    });
  }

  return recordExecutionContext(first, second!);
}

export const executionAsyncContext: ExecutionContextAccessor = Object.freeze({
  id: "executionContext",
  use() {
    const current = getCurrentExecutionContext();
    if (!current) {
      contextError.throw({
        details:
          "Execution context is not available. Register resources.executionContext on your app, or create one manually via asyncContexts.execution.provide(...) / record(...).",
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
