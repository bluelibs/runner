import { Logger } from "./Logger";

export type UnhandledErrorKind =
  | "process"
  | "task"
  | "middleware"
  | "resourceInit"
  | "hook"
  | "run";

export interface OnUnhandledErrorInfo {
  error: unknown;
  kind?: UnhandledErrorKind;
  source?: string;
}

export type OnUnhandledError = (
  info: OnUnhandledErrorInfo
) => void | Promise<void>;

export function createDefaultUnhandledError(logger: Logger): OnUnhandledError {
  return async ({ error, kind, source }: OnUnhandledErrorInfo) => {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    await logger.error("Unhandled error", {
      source,
      error: normalizedError,
      data: kind ? { kind } : undefined,
    });
  };
}

export function bindProcessErrorHandler(
  handler: OnUnhandledError
): (
  error: unknown,
  source: "uncaughtException" | "unhandledRejection"
) => void | Promise<void> {
  return async (error, source) => {
    try {
      await handler({ error, kind: "process", source });
    } catch {}
  };
}

export async function safeReportUnhandledError(
  handler: OnUnhandledError,
  info: OnUnhandledErrorInfo
): Promise<void> {
  try {
    await handler(info);
  } catch {}
}
