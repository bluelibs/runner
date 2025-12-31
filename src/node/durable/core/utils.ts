import { clearTimeout, setTimeout } from "node:timers";
import * as crypto from "node:crypto";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
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
} | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (state === "waiting") {
    const timerId = value.timerId;
    return {
      state: "waiting",
      timerId: typeof timerId === "string" ? timerId : undefined,
    };
  }
  if (state === "completed") {
    return { state: "completed" };
  }
  if (state === "timed_out") {
    return { state: "timed_out" };
  }
  return null;
}

export class DurableExecutionError extends Error {
  constructor(
    message: string,
    public readonly executionId: string,
    public readonly taskId: string,
    public readonly attempt: number,
    public readonly causeInfo?: { message: string; stack?: string },
  ) {
    super(message);
    this.name = "DurableExecutionError";
  }
}
