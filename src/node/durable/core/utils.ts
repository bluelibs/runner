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
  timeoutMs?: number;
} | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  const signalId =
    typeof value.signalId === "string" ? value.signalId : undefined;
  if (state === "waiting") {
    const timeoutMs = value.timeoutMs;
    const timerId = value.timerId;
    return {
      state: "waiting",
      timerId: typeof timerId === "string" ? timerId : undefined,
      signalId,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
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

export function parseSleepState(value: unknown):
  | {
      state: "sleeping";
      timerId: string;
      fireAtMs: number;
      durationMs?: number;
    }
  | {
      state: "completed";
    }
  | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.state === "completed") {
    return { state: "completed" };
  }

  if (
    value.state === "sleeping" &&
    typeof value.timerId === "string" &&
    typeof value.fireAtMs === "number"
  ) {
    return {
      state: "sleeping",
      timerId: value.timerId,
      fireAtMs: value.fireAtMs,
      durationMs:
        typeof value.durationMs === "number" ? value.durationMs : undefined,
    };
  }

  return null;
}

export function parseExecutionWaitState(value: unknown):
  | {
      state: "waiting";
      targetExecutionId: string;
      timeoutMs?: number;
      timerId?: string;
      timeoutAtMs?: number;
    }
  | {
      state: "completed";
      targetExecutionId: string;
      workflowKey: string;
      result: unknown;
    }
  | {
      state: "failed" | "cancelled";
      targetExecutionId: string;
      error: { message: string; stack?: string };
      workflowKey: string;
      attempt: number;
    }
  | {
      state: "timed_out";
      targetExecutionId: string;
    }
  | null {
  if (!isRecord(value)) return null;
  if (typeof value.targetExecutionId !== "string") return null;

  const state = value.state;
  const targetExecutionId = value.targetExecutionId;

  if (state === "waiting") {
    const timeoutMs = value.timeoutMs;
    const timeoutAtMs = value.timeoutAtMs;
    const timerId = value.timerId;
    if (typeof timeoutAtMs === "number" && typeof timerId === "string") {
      return {
        state,
        targetExecutionId,
        timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
        timeoutAtMs,
        timerId,
      };
    }
    return {
      state,
      targetExecutionId,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
    };
  }

  if (state === "completed") {
    if (typeof value.workflowKey !== "string") {
      return null;
    }

    return {
      state,
      targetExecutionId,
      workflowKey: value.workflowKey,
      result: value.result,
    };
  }

  if (state === "failed" || state === "cancelled") {
    const error = value.error;
    if (
      !isRecord(error) ||
      typeof error.message !== "string" ||
      typeof value.workflowKey !== "string" ||
      typeof value.attempt !== "number"
    ) {
      return null;
    }

    return {
      state,
      targetExecutionId,
      error: {
        message: error.message,
        stack: typeof error.stack === "string" ? error.stack : undefined,
      },
      workflowKey: value.workflowKey,
      attempt: value.attempt,
    };
  }

  if (state === "timed_out") {
    return { state, targetExecutionId };
  }

  return null;
}

/**
 * Returns whether a signal step id is stable enough to persist its signal id in
 * stored step state instead of relying on the generated `__signal:*` form.
 */
export function shouldPersistStableSignalId(
  stepId: string,
  signalId: string,
): boolean {
  const baseStepId = `__signal:${signalId}`;
  if (stepId !== baseStepId && !stepId.startsWith(`${baseStepId}:`)) {
    return true;
  }

  const lastColonIndex = signalId.lastIndexOf(":");
  if (stepId !== baseStepId || lastColonIndex === -1) {
    return false;
  }

  const possibleIndex = signalId.slice(lastColonIndex + 1);
  const parsedIndex = Number(possibleIndex);
  return Number.isInteger(parsedIndex) && parsedIndex >= 0;
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
  workflowKey: string;
  attempt: number;
  causeInfo?: { message: string; stack?: string };
}> {
  constructor(
    message: string,
    public readonly executionId: string,
    public readonly workflowKey: string,
    public readonly attempt: number,
    public readonly causeInfo?: { message: string; stack?: string },
  ) {
    super(
      RunnerErrorId.DurableExecutionError,
      message,
      {
        message,
        executionId,
        workflowKey,
        attempt,
        causeInfo,
      },
      durableExecutionError.httpCode,
      undefined,
      durableExecutionError[symbolDefinitionIdentity],
    );
  }
}
