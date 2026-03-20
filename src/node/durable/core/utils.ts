import { clearTimeout, setTimeout } from "node:timers";
import * as crypto from "node:crypto";
import { RunnerError } from "../../../definers/defineError";
import {
  durableExecutionError,
  genericError,
  RunnerErrorId,
} from "../../../errors";
import { symbolDefinitionIdentity } from "../../../types/symbols";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

const timeoutExceededSymbol = Symbol("runner.timeoutExceeded");

type TimeoutExceededError = Error & {
  [timeoutExceededSymbol]: true;
};

function createTimeoutExceededError(message: string): TimeoutExceededError {
  return Object.assign(genericError.new({ message }), {
    [timeoutExceededSymbol]: true as const,
  });
}

export function isTimeoutExceededError(
  error: unknown,
): error is TimeoutExceededError {
  return (
    error instanceof Error &&
    (error as Partial<TimeoutExceededError>)[timeoutExceededSymbol] === true
  );
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(createTimeoutExceededError(message)),
      timeoutMs,
    );
    timer.unref();
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createExecutionId(): string {
  return crypto.randomUUID();
}

export function parseSignalState(value: unknown): {
  state: "waiting" | "completed" | "timed_out";
  timerId?: string;
  signalId?: string;
} | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  const signalId =
    typeof value.signalId === "string" ? value.signalId : undefined;
  if (state === "waiting") {
    const timerId = value.timerId;
    return {
      state: "waiting",
      timerId: typeof timerId === "string" ? timerId : undefined,
      signalId,
    };
  }
  if (state === "completed") {
    return { state: "completed", signalId };
  }
  if (state === "timed_out") {
    return { state: "timed_out", signalId };
  }
  return null;
}

export function shouldPersistStableSignalId(
  stepId: string,
  signalId: string,
): boolean {
  const baseStepId = `__signal:${signalId}`;
  return stepId !== baseStepId && !stepId.startsWith(`${baseStepId}:`);
}

/**
 * Error thrown to consumers waiting on an execution (`DurableService.wait/execute*`).
 *
 * Distinguishes durable execution failures/timeouts/cancellations from ordinary
 * task errors by carrying execution metadata and a (serialized) cause payload.
 * `WaitManager` is the primary producer of this error.
 */
export class DurableExecutionError extends RunnerError<{
  message: string;
  executionId: string;
  taskId: string;
  attempt: number;
  causeInfo?: { message: string; stack?: string };
}> {
  constructor(
    message: string,
    public readonly executionId: string,
    public readonly taskId: string,
    public readonly attempt: number,
    public readonly causeInfo?: { message: string; stack?: string },
  ) {
    super(
      RunnerErrorId.DurableExecutionError,
      message,
      {
        message,
        executionId,
        taskId,
        attempt,
        causeInfo,
      },
      durableExecutionError.httpCode,
      undefined,
      durableExecutionError[symbolDefinitionIdentity],
    );
  }
}
