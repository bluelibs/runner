import { contextError } from "./errors";
import {
  getCurrentExecutionContext,
  provideExecutionContext,
  recordExecutionContext,
} from "./models/ExecutionContextStore";
import type {
  ExecutionContextAccessor,
  ExecutionRecordResult,
  ExecutionContextProvideOptions,
} from "./types/executionContext";

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

const executionContextAccessor: ExecutionContextAccessor = Object.freeze({
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
  provide,
  record,
});

export const asyncContexts = Object.freeze({
  execution: executionContextAccessor,
});
